/**
 * pi-web-server: HTTP + WebSocket bridge to pi-coding-agent RPC backend.
 *
 * - Serves the built frontend from dist/public/
 * - Maintains ONE persistent pi process shared across all WebSocket connections
 * - Bridges agent stdout JSONL → WebSocket messages (broadcast to all connected clients)
 * - Bridges WebSocket messages → agent stdin JSONL
 * - Restarts the agent process automatically if it exits
 */

import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";

const PORT = parseInt(process.env.PORT ?? "8486", 10);

// Web-specific session directory — separate from CLI sessions
const WEB_SESSION_DIR = join(process.env.HOME ?? "/Users/tbmini", ".pi", "agent", "sessions", "web");
mkdirSync(WEB_SESSION_DIR, { recursive: true });

// Resolve paths relative to this compiled file (dist/server.js)
const PUBLIC_DIR = fileURLToPath(new URL("public", import.meta.url));
const PI_PATH = process.env.PI_PATH ?? "/opt/homebrew/bin/pi";

// Working directory for the persistent agent process
const PI_WORKDIR = process.env.PI_WORKDIR ?? process.env.HOME ?? "/Users/tbmini";

const SYSTEM_PROMPT =
	`You are Pi, a coding and task assistant running on a Mac mini. ` +
	`You have access to the filesystem at ${PI_WORKDIR} and can run shell commands. ` +
	`Be concise and helpful.`;

const MIME: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "application/javascript",
	".mjs": "application/javascript",
	".css": "text/css",
	".json": "application/json",
	".png": "image/png",
	".ico": "image/x-icon",
	".svg": "image/svg+xml",
	".wasm": "application/wasm",
	".woff": "font/woff",
	".woff2": "font/woff2",
};

interface SessionSnapshot {
	sessionFile?: string;
	messages: unknown[];
}

interface SessionSummary {
	fileName: string;
	sessionId: string;
	title: string;
	createdAt: string;
	lastModified: string;
	messageCount: number;
	preview: string;
	parentSession?: string;
}

const SESSION_DIR_RESOLVED = resolve(WEB_SESSION_DIR);
let currentSessionFile: string | undefined;
let awaitingFreshSession = false;

function extractText(content: unknown): string {
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => {
			if (!part || typeof part !== "object") return "";
			const item = part as Record<string, unknown>;
			if (typeof item.text === "string") return item.text;
			if (typeof item.thinking === "string") return item.thinking;
			return "";
		})
		.filter(Boolean)
		.join(" ")
		.trim();
}

function resolveSessionFile(sessionFile?: string): string | undefined {
	if (!sessionFile) return undefined;
	const resolved = resolve(SESSION_DIR_RESOLVED, sessionFile);
	if (resolved !== SESSION_DIR_RESOLVED && !resolved.startsWith(`${SESSION_DIR_RESOLVED}/`)) {
		return undefined;
	}
	return resolved;
}

function loadTranscript(sessionFile?: string): SessionSnapshot {
	const resolvedFile = resolveSessionFile(sessionFile);
	try {
		if (!resolvedFile && awaitingFreshSession) {
			return { sessionFile: undefined, messages: [] };
		}

		const fileToRead = resolvedFile ?? getLatestSessionFile();
		if (!fileToRead) {
			return { sessionFile: undefined, messages: [] };
		}

		const content = readFileSync(fileToRead, "utf8");
		const byId = new Map<string, unknown>();
		for (const line of content.split("\n")) {
			if (!line.trim()) continue;
			try {
				const event = JSON.parse(line);
				if (event.type === "message" && event.id && event.message) {
					byId.set(event.id, event.message);
				}
			} catch {
				/* skip malformed lines */
			}
		}
		return { sessionFile: fileToRead, messages: Array.from(byId.values()) };
	} catch {
		return { sessionFile: resolvedFile, messages: [] };
	}
}

function getLatestSessionFile(): string | undefined {
	try {
		const files = readdirSync(WEB_SESSION_DIR)
			.filter((f) => f.endsWith(".jsonl"))
			.map((fileName) => ({
				fileName,
				path: join(WEB_SESSION_DIR, fileName),
				mtime: statSync(join(WEB_SESSION_DIR, fileName)).mtimeMs,
			}))
			.sort((a, b) => b.mtime - a.mtime);
		return files[0]?.path;
	} catch {
		return undefined;
	}
}

function listSessions(): SessionSummary[] {
	try {
		const files = readdirSync(WEB_SESSION_DIR).filter((f) => f.endsWith(".jsonl"));
		const sessions = files
			.map((fileName): SessionSummary | null => {
				const filePath = join(WEB_SESSION_DIR, fileName);
				let content: string;
				try {
					content = readFileSync(filePath, "utf8");
				} catch {
					return null;
				}

				let sessionId = fileName.replace(/\.jsonl$/, "");
				let title = "";
				let createdAt = statSync(filePath).mtime.toISOString();
				let parentSession: string | undefined;
				let messageCount = 0;
				let preview = "";

				for (const line of content.split("\n")) {
					if (!line.trim()) continue;
					try {
						const entry = JSON.parse(line) as Record<string, unknown>;
						if (entry.type === "session") {
							if (typeof entry.id === "string") sessionId = entry.id;
							if (typeof entry.timestamp === "string") createdAt = entry.timestamp;
							if (typeof entry.parentSession === "string") parentSession = entry.parentSession;
						} else if (entry.type === "session_info") {
							const name = typeof entry.name === "string" ? entry.name.trim() : "";
							if (name) title = name;
						} else if (entry.type === "message") {
							messageCount += 1;
							if (!preview && entry.message && typeof entry.message === "object") {
								const message = entry.message as Record<string, unknown>;
								const extracted = extractText(message.content);
								if (extracted) preview = extracted.slice(0, 160);
								if (!title && extracted) title = extracted.split(/\n/)[0].slice(0, 80);
							}
						}
					} catch {
						/* skip malformed lines */
					}
				}

				return {
					fileName,
					sessionId,
					title: title || sessionId,
					createdAt,
					lastModified: statSync(filePath).mtime.toISOString(),
					messageCount,
					preview,
					parentSession,
				};
			})
			.filter((session): session is SessionSummary => session !== null)
			.sort((a, b) => b.lastModified.localeCompare(a.lastModified));

		return sessions;
	} catch {
		return [];
	}
}

function broadcastSessionSnapshot(sessionFile?: string): void {
	const snapshot = loadTranscript(sessionFile);
	broadcast(JSON.stringify({ type: "session_snapshot", ...snapshot }));
}

// ---------------------------------------------------------------------------
// HTTP server — serves static frontend files with SPA fallback
// ---------------------------------------------------------------------------

const http = createServer(async (req, res) => {
	const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
	if (req.method === "GET" && requestUrl.pathname === "/api/sessions") {
		res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
		res.end(JSON.stringify(listSessions()));
		return;
	}

	let urlPath = requestUrl.pathname;
	if (urlPath === "/pi") urlPath = "/pi/";
	if (urlPath.startsWith("/pi/")) urlPath = urlPath.slice(3);
	if (urlPath === "/") urlPath = "/index.html";

	const filePath = join(PUBLIC_DIR, urlPath);

	try {
		await access(filePath);
		const data = await readFile(filePath);
		const mime = MIME[extname(filePath)] ?? "application/octet-stream";
		res.writeHead(200, { "Content-Type": mime });
		res.end(data);
	} catch {
		// SPA fallback
		try {
			const data = await readFile(join(PUBLIC_DIR, "index.html"));
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			res.end(data);
		} catch {
			res.writeHead(404);
			res.end("Not found");
		}
	}
});

// ---------------------------------------------------------------------------
// Persistent agent — one pi process shared by all WebSocket connections
// ---------------------------------------------------------------------------

const clients = new Set<WebSocket>();
let agentProcess: ChildProcess | null = null;
let restarting = false;
const stdinQueue: string[] = []; // queue for stdin while agent is respawning

function broadcast(message: string) {
	for (const ws of clients) {
		if (ws.readyState === WebSocket.OPEN) {
			ws.send(message);
		}
	}
}

function handleAgentOutputLine(line: string): void {
	try {
		const event = JSON.parse(line) as Record<string, unknown>;
		if (event.type === "response" && event.command === "get_state" && event.success === true) {
			const data = event.data as Record<string, unknown> | undefined;
			if (data && typeof data.sessionFile === "string") {
				currentSessionFile = data.sessionFile;
				awaitingFreshSession = false;
			}
		}
	} catch {
		/* not JSON */
	}
}

function spawnAgent(sessionFile?: string, continueLatest = false) {
	currentSessionFile = resolveSessionFile(sessionFile) ?? getLatestSessionFile();
	console.log(`[server] Spawning persistent agent: ${PI_PATH}`);
	console.log(`[server] cwd: ${PI_WORKDIR}`);
	console.log(`[server] session: ${currentSessionFile ?? "(new)"}`);

	const args = ["--mode", "rpc", "--session-dir", WEB_SESSION_DIR, "--system-prompt", SYSTEM_PROMPT];
	if (sessionFile) {
		args.splice(2, 0, "--session", resolveSessionFile(sessionFile) ?? sessionFile);
	} else if (continueLatest) {
		args.splice(2, 0, "--continue");
	}

	const proc = spawn(PI_PATH, args, {
		stdio: ["pipe", "pipe", "pipe"],
		cwd: PI_WORKDIR,
	});

	agentProcess = proc;
	console.log(`[server] Agent PID ${proc.pid}`);

	proc.stderr?.on("data", (chunk: Buffer) => {
		process.stderr.write(`[agent] ${chunk.toString()}`);
	});

	const decoder = new StringDecoder("utf8");
	let buf = "";

	proc.stdout?.on("data", (chunk: Buffer) => {
		buf += decoder.write(chunk);
		while (true) {
			const nl = buf.indexOf("\n");
			if (nl === -1) break;
			const line = buf.slice(0, nl).replace(/\r$/, "");
			buf = buf.slice(nl + 1);
			if (line) {
				handleAgentOutputLine(line);
				broadcast(line);
			}
		}
	});

	proc.stdout?.on("end", () => {
		const remaining = (buf + decoder.end()).replace(/\r$/, "");
		if (remaining) {
			handleAgentOutputLine(remaining);
			broadcast(remaining);
		}
	});

	proc.on("exit", (code) => {
		console.log(`[server] Agent exited with code ${code}`);
		agentProcess = null;

		if (clients.size > 0 && !restarting) {
			// Notify clients and restart
			broadcast(
				JSON.stringify({
					type: "server_error",
					message: `Agent process exited (code ${code}). Restarting…`,
				}),
			);
			restarting = true;
			setTimeout(() => {
				restarting = false;
				spawnAgent(currentSessionFile, !currentSessionFile);
			}, 1000);
		}
	});

	// Flush any stdin messages that arrived while the agent was respawning
	if (stdinQueue.length > 0) {
		const queued = stdinQueue.splice(0);
		setTimeout(() => {
			for (const msg of queued) {
				if (proc.stdin?.writable) proc.stdin.write(msg);
			}
			console.log(`[server] Flushed ${queued.length} queued message(s) to agent stdin`);
		}, 200);
	}

	broadcastSessionSnapshot(currentSessionFile);
	return proc;
}

// Start the persistent agent immediately
spawnAgent(undefined, true);

// ---------------------------------------------------------------------------
// WebSocket server — clients attach to the shared agent process
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({ server: http, path: "/ws" });

wss.on("connection", (ws) => {
	console.log(`[server] WebSocket client connected (total: ${clients.size + 1})`);
	clients.add(ws);

	// Hydrate new client with the prior session transcript
	const snapshot = loadTranscript(currentSessionFile);
	if (snapshot.messages.length > 0 || snapshot.sessionFile) {
		ws.send(JSON.stringify({ type: "session_snapshot", ...snapshot }));
		console.log(`[server] Sent session_snapshot with ${snapshot.messages.length} message(s)`);
	}

	// If agent died while no clients were connected, restart it now
	if (!agentProcess && !restarting) {
		restarting = true;
		setTimeout(() => {
			restarting = false;
			spawnAgent(currentSessionFile, !currentSessionFile);
		}, 100);
	}

	// Bridge: WebSocket → agent stdin (each message is one JSONL command)
	// Special control messages are handled here and NOT forwarded to the agent.
	ws.on("message", (data: Buffer | string) => {
		const text = Buffer.isBuffer(data) ? data.toString() : data;

		// Check for slash-command control messages before forwarding
		let parsed: Record<string, unknown> | null = null;
		try {
			parsed = JSON.parse(text) as Record<string, unknown>;
		} catch {
			/* not JSON */
		}

		if (parsed?.type === "new_session") {
			console.log("[server] Received new_session from client");
			currentSessionFile = undefined;
			awaitingFreshSession = true;
			broadcastSessionSnapshot(undefined);
			if (agentProcess?.stdin?.writable) {
				agentProcess.stdin.write(`${text}\n`);
			} else {
				console.log("[server] Agent not ready — queuing new_session for delivery after respawn");
				stdinQueue.push(`${text}\n`);
			}
			return;
		}

		if (parsed?.type === "load_session" && typeof parsed.sessionFile === "string") {
			const sessionFile = resolveSessionFile(parsed.sessionFile);
			if (!sessionFile) {
				broadcast(
					JSON.stringify({
						type: "server_error",
						message: `Invalid session file: ${String(parsed.sessionFile)}`,
					}),
				);
				return;
			}

			console.log(`[server] Loading session ${sessionFile}`);
			currentSessionFile = sessionFile;
			awaitingFreshSession = false;
			broadcastSessionSnapshot(sessionFile);
			const switchSessionCmd = JSON.stringify({ type: "switch_session", sessionPath: sessionFile });
			if (agentProcess?.stdin?.writable) {
				agentProcess.stdin.write(`${switchSessionCmd}\n`);
			} else {
				console.log("[server] Agent not ready — queuing switch_session for delivery after respawn");
				stdinQueue.push(`${switchSessionCmd}\n`);
			}
			return;
		}

		if (agentProcess?.stdin?.writable) {
			agentProcess.stdin.write(`${text}\n`);
		} else {
			console.log("[server] Agent not ready — queuing message for delivery after respawn");
			stdinQueue.push(`${text}\n`);
		}
	});

	ws.on("close", () => {
		clients.delete(ws);
		console.log(`[server] WebSocket client disconnected (remaining: ${clients.size})`);
		// Do NOT kill the agent — keep it alive for the next connection
	});

	ws.on("error", (err) => {
		console.error("[server] WebSocket error:", err.message);
		clients.delete(ws);
	});
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

http.listen(PORT, () => {
	console.log(`[server] Running at http://localhost:${PORT}`);
	console.log(`[server] pi path: ${PI_PATH}`);
	console.log(`[server] workdir: ${PI_WORKDIR}`);
	console.log(`[server] static: ${PUBLIC_DIR}`);
});
