/**
 * pi-web-server: HTTP + WebSocket bridge to pi-coding-agent RPC backend.
 *
 * Environment variables:
 *   PORT            Port to listen on (default: 8484)
 *   PI_PATH         Path to the pi CLI binary (default: /opt/homebrew/bin/pi)
 *   PI_WORKDIR      Working directory for the agent process (default: os.homedir())
 *   WEB_SESSION_DIR Directory for web UI sessions (default: ~/.pi/agent/sessions/web)
 *   CLI_SESSION_DIR Directory for CLI sessions shown in session switcher
 *                   (default: ~/.pi/agent/sessions/--<encoded-homedir>--)
 *   BASE_PATH       URL prefix for this app (default: /pi)
 *   SYSTEM_PROMPT   System prompt sent to the agent on spawn
 *
 * Design notes:
 *   - ONE persistent pi process is shared across all browser tabs/WebSocket connections.
 *   - The agent is restarted automatically if it exits.
 *   - stdin messages arriving during a respawn are queued (up to QUEUE_MAX_SIZE).
 */
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import { extname, join, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";

// ---------------------------------------------------------------------------
// Named constants
// ---------------------------------------------------------------------------
const MAX_SNAPSHOT  = 30;    // max messages to hydrate new clients with
const QUEUE_MAX_SIZE = 100;  // max stdin messages to queue while agent respawns

// ---------------------------------------------------------------------------
// Configuration — all values overridable via environment variables
// ---------------------------------------------------------------------------
const HOME = os.homedir();

// Encode homedir as a path segment used by the pi CLI for its session dirs.
// e.g. /Users/tbmini → --Users-tbmini-- (replace "/" with "-", strip leading "-")
const encodedHome = HOME.replace(/\//g, "-").replace(/^-/, "");
const CLI_SESSION_DIR_DEFAULT = join(HOME, ".pi", "agent", "sessions", `--${encodedHome}--`);

const PORT         = parseInt(process.env.PORT ?? "8484", 10);
const PI_PATH      = process.env.PI_PATH      ?? "/opt/homebrew/bin/pi";
const PI_WORKDIR   = process.env.PI_WORKDIR   ?? HOME;
const BASE_PATH    = process.env.BASE_PATH    ?? "/pi";
const WEB_SESSION_DIR = process.env.WEB_SESSION_DIR ?? join(HOME, ".pi", "agent", "sessions", "web");
const CLI_SESSION_DIR = process.env.CLI_SESSION_DIR ?? CLI_SESSION_DIR_DEFAULT;

const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT ??
    `You are Pi, a coding and task assistant. ` +
    `You have access to the filesystem at ${PI_WORKDIR} and can run shell commands. ` +
    `Be concise and helpful.`;

// Resolve paths relative to this source file (src/server.js → dist/public lives one level up)
const __dir = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = resolve(__dir, "..", "dist", "public");

mkdirSync(WEB_SESSION_DIR, { recursive: true });

const MIME = {
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
const SESSION_DIR_RESOLVED = resolve(WEB_SESSION_DIR);
let currentSessionFile;
let awaitingFreshSession = false;

function extractText(content) {
    if (typeof content === "string")
        return content.trim();
    if (!Array.isArray(content))
        return "";
    return content
        .map((part) => {
        if (!part || typeof part !== "object")
            return "";
        const item = part;
        if (typeof item.text === "string")
            return item.text;
        if (typeof item.thinking === "string")
            return item.thinking;
        return "";
    })
        .filter(Boolean)
        .join(" ")
        .trim();
}
function resolveSessionFile(sessionFile) {
    if (!sessionFile)
        return undefined;
    const resolved = resolve(SESSION_DIR_RESOLVED, sessionFile);
    if (resolved !== SESSION_DIR_RESOLVED && !resolved.startsWith(`${SESSION_DIR_RESOLVED}/`)) {
        return undefined;
    }
    return resolved;
}
function loadTranscript(sessionFile) {
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
        const byId = new Map();
        for (const line of content.split("\n")) {
            if (!line.trim())
                continue;
            try {
                const event = JSON.parse(line);
                if (event.type === "message" && event.id && event.message) {
                    byId.set(event.id, event.message);
                }
            }
            catch {
                /* skip malformed lines */
            }
        }
        const allMessages = Array.from(byId.values());
        const messages = allMessages.length > MAX_SNAPSHOT
            ? allMessages.slice(allMessages.length - MAX_SNAPSHOT)
            : allMessages;
        return { sessionFile: fileToRead, messages };
    }
    catch {
        return { sessionFile: resolvedFile, messages: [] };
    }
}
function getLatestSessionFile() {
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
    }
    catch {
        return undefined;
    }
}
function parseSessionFile(filePath, fileName, source) {
    let content;
    try {
        content = readFileSync(filePath, "utf8");
    }
    catch {
        return null;
    }
    let sessionId = fileName.replace(/\.jsonl$/, "");
    let title = "";
    let createdAt = statSync(filePath).mtime.toISOString();
    let parentSession;
    let messageCount = 0;
    let preview = "";
    const tsMatch = fileName.match(/^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/);
    if (tsMatch) {
        createdAt = tsMatch[1].replace(/T(\d{2})-(\d{2})-(\d{2})/, "T$1:$2:$3") + ".000Z";
    }
    for (const line of content.split("\n")) {
        if (!line.trim())
            continue;
        try {
            const entry = JSON.parse(line);
            if (entry.type === "session") {
                if (typeof entry.id === "string")
                    sessionId = entry.id;
                if (typeof entry.timestamp === "string")
                    createdAt = entry.timestamp;
                if (typeof entry.parentSession === "string")
                    parentSession = entry.parentSession;
            }
            else if (entry.type === "session_info") {
                const name = typeof entry.name === "string" ? entry.name.trim() : "";
                if (name)
                    title = name;
            }
            else if (entry.type === "message") {
                messageCount += 1;
                if (!preview && entry.message && typeof entry.message === "object") {
                    const message = entry.message;
                    if (message.role === "user") {
                        const extracted = extractText(message.content);
                        if (extracted)
                            preview = extracted.slice(0, 80);
                        if (!title && extracted)
                            title = extracted.split(/\n/)[0].slice(0, 80);
                    }
                }
            }
        }
        catch {
            /* skip malformed lines */
        }
    }
    return {
        source,
        filename: filePath,
        fileName,
        sessionId,
        title: title || sessionId,
        createdAt,
        lastModified: statSync(filePath).mtime.toISOString(),
        messageCount,
        preview,
        parentSession,
    };
}
function listSessions() {
    const allSessions = [];
    const dirs = [
        { dir: WEB_SESSION_DIR, source: "web" },
        { dir: CLI_SESSION_DIR, source: "cli" },
    ];
    for (const { dir, source } of dirs) {
        try {
            const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
            for (const fileName of files) {
                const filePath = join(dir, fileName);
                const session = parseSessionFile(filePath, fileName, source);
                if (session)
                    allSessions.push(session);
            }
        }
        catch {
            /* directory may not exist */
        }
    }
    return allSessions.sort((a, b) => b.lastModified.localeCompare(a.lastModified));
}
function broadcastSessionSnapshot(sessionFile) {
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
    if (req.method === "POST" && requestUrl.pathname === "/api/sessions/switch") {
        let body = "";
        req.on("data", (chunk) => { body += chunk.toString(); });
        req.on("end", () => {
            try {
                const { sessionFile } = JSON.parse(body);
                if (typeof sessionFile !== "string") {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "sessionFile required" }));
                    return;
                }
                const webDir = resolve(WEB_SESSION_DIR);
                const cliDir = resolve(CLI_SESSION_DIR);
                const resolved = resolve(sessionFile);
                if (!resolved.startsWith(webDir + "/") && !resolved.startsWith(cliDir + "/")) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Invalid session file path" }));
                    return;
                }
                const parentDir = resolved.startsWith(webDir + "/") ? webDir : cliDir;
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true }));
                switchToSession(resolved, parentDir);
            }
            catch (e) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: String(e) }));
            }
        });
        return;
    }
    let urlPath = requestUrl.pathname;
    // Redirect bare root to BASE_PATH/ so the frontend always runs under the base path
    if (urlPath === "/") {
        res.writeHead(302, { "Location": BASE_PATH + "/" });
        res.end();
        return;
    }
    if (urlPath === BASE_PATH)
        urlPath = BASE_PATH + "/";
    if (urlPath.startsWith(BASE_PATH + "/"))
        urlPath = urlPath.slice(BASE_PATH.length);
    if (urlPath === "/")
        urlPath = "/index.html";
    const filePath = join(PUBLIC_DIR, urlPath);
    try {
        await access(filePath);
        const data = await readFile(filePath);
        const mime = MIME[extname(filePath)] ?? "application/octet-stream";
        res.writeHead(200, { "Content-Type": mime });
        res.end(data);
    }
    catch {
        // SPA fallback
        try {
            const data = await readFile(join(PUBLIC_DIR, "index.html"));
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(data);
        }
        catch {
            res.writeHead(404);
            res.end("Not found");
        }
    }
});

// ---------------------------------------------------------------------------
// Persistent agent — one pi process shared by all WebSocket connections
// ---------------------------------------------------------------------------
const clients = new Set();
let agentProcess = null;
let restarting = false;
let stdinQueue = [];
function broadcast(message) {
    for (const ws of clients) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(message);
        }
    }
}
function handleAgentOutputLine(line) {
    try {
        const event = JSON.parse(line);
        if (event.type === "response" && event.command === "get_state" && event.success === true) {
            const data = event.data;
            if (data && typeof data.sessionFile === "string") {
                currentSessionFile = data.sessionFile;
                awaitingFreshSession = false;
            }
        }
    }
    catch {
        /* not JSON */
    }
}

/**
 * Shared helper: spawn a pi process, wire up stderr, stdout line-buffering
 * (using StringDecoder), and auto-restart on exit. Returns the child process.
 */
function spawnPiProcess(args) {
    console.log(`[server] Spawning: ${PI_PATH} ${args.join(" ")}`);
    const proc = spawn(PI_PATH, args, {
        stdio: ["pipe", "pipe", "pipe"],
        cwd: PI_WORKDIR,
    });
    agentProcess = proc;
    console.log(`[server] Agent PID ${proc.pid}`);
    proc.stderr?.on("data", (chunk) => {
        process.stderr.write(`[agent] ${chunk.toString()}`);
    });
    const decoder = new StringDecoder("utf8");
    let buf = "";
    proc.stdout?.on("data", (chunk) => {
        buf += decoder.write(chunk);
        while (true) {
            const nl = buf.indexOf("\n");
            if (nl === -1)
                break;
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
            broadcast(JSON.stringify({
                type: "server_error",
                message: `Agent process exited (code ${code}). Restarting…`,
            }));
            restarting = true;
            setTimeout(() => {
                restarting = false;
                spawnAgent(currentSessionFile, !currentSessionFile);
            }, 1000);
        }
    });
    return proc;
}

/** Switch to any session file (web or CLI), respawning with the correct --session-dir. */
function switchToSession(sessionFile, sessionDir) {
    if (restarting)
        return;
    restarting = true;
    stdinQueue = [];
    console.log(`[server] switchToSession — switching to ${sessionFile} (dir: ${sessionDir})`);
    if (agentProcess) {
        agentProcess.kill("SIGTERM");
        agentProcess = null;
    }
    setTimeout(() => {
        restarting = false;
        currentSessionFile = sessionFile;
        const args = [
            "--mode", "rpc",
            "--session", sessionFile,
            "--session-dir", sessionDir,
            "--system-prompt", SYSTEM_PROMPT,
        ];
        spawnPiProcess(args);
        broadcast(JSON.stringify({ type: "session_cleared" }));
        broadcastSessionSnapshot(sessionFile);
    }, 500);
}

/** Kill the current agent and spawn a fresh one, then notify all clients. */
function killAndRespawn(sessionFile) {
    if (restarting)
        return;
    restarting = true;
    stdinQueue = [];
    console.log("[server] killAndRespawn — starting fresh agent session");
    if (agentProcess) {
        agentProcess.kill("SIGTERM");
        agentProcess = null;
    }
    setTimeout(() => {
        restarting = false;
        spawnAgent(sessionFile);
        broadcast(JSON.stringify({ type: "session_cleared" }));
        broadcastSessionSnapshot(sessionFile ?? currentSessionFile);
    }, 500);
}

function spawnAgent(sessionFile, continueLatest = false) {
    currentSessionFile = resolveSessionFile(sessionFile) ?? getLatestSessionFile();
    console.log(`[server] cwd: ${PI_WORKDIR}`);
    console.log(`[server] session: ${currentSessionFile ?? "(new)"}`);
    const args = ["--mode", "rpc", "--session-dir", WEB_SESSION_DIR, "--system-prompt", SYSTEM_PROMPT];
    if (sessionFile) {
        args.splice(2, 0, "--session", resolveSessionFile(sessionFile) ?? sessionFile);
    }
    else if (continueLatest) {
        args.splice(2, 0, "--continue");
    }
    const proc = spawnPiProcess(args);
    // Flush any stdin messages that arrived while the agent was respawning
    if (stdinQueue.length > 0) {
        const queued = stdinQueue.splice(0);
        setTimeout(() => {
            for (const msg of queued) {
                if (proc.stdin?.writable)
                    proc.stdin.write(msg);
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
const wss = new WebSocketServer({ server: http, path: BASE_PATH + "/ws" });
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
    ws.on("message", (data) => {
        const text = Buffer.isBuffer(data) ? data.toString() : data;
        let parsed = null;
        try {
            parsed = JSON.parse(text);
        }
        catch {
            /* not JSON */
        }
        if (parsed?.type === "new_session") {
            console.log("[server] Received new_session from client");
            currentSessionFile = undefined;
            awaitingFreshSession = true;
            broadcastSessionSnapshot(undefined);
            if (agentProcess?.stdin?.writable) {
                agentProcess.stdin.write(`${text}\n`);
            }
            else {
                console.log("[server] Agent not ready — queuing new_session for delivery after respawn");
                if (stdinQueue.length < QUEUE_MAX_SIZE)
                    stdinQueue.push(`${text}\n`);
            }
            return;
        }
        if (parsed?.type === "load_session" && typeof parsed.sessionFile === "string") {
            const sessionFile = resolveSessionFile(parsed.sessionFile);
            if (!sessionFile) {
                broadcast(JSON.stringify({
                    type: "server_error",
                    message: `Invalid session file: ${String(parsed.sessionFile)}`,
                }));
                return;
            }
            console.log(`[server] Loading session ${sessionFile}`);
            currentSessionFile = sessionFile;
            awaitingFreshSession = false;
            broadcastSessionSnapshot(sessionFile);
            const switchSessionCmd = JSON.stringify({ type: "switch_session", sessionPath: sessionFile });
            if (agentProcess?.stdin?.writable) {
                agentProcess.stdin.write(`${switchSessionCmd}\n`);
            }
            else {
                console.log("[server] Agent not ready — queuing switch_session for delivery after respawn");
                if (stdinQueue.length < QUEUE_MAX_SIZE)
                    stdinQueue.push(`${switchSessionCmd}\n`);
            }
            return;
        }
        if (agentProcess?.stdin?.writable) {
            agentProcess.stdin.write(`${text}\n`);
        }
        else {
            console.log("[server] Agent not ready — queuing message for delivery after respawn");
            if (stdinQueue.length < QUEUE_MAX_SIZE)
                stdinQueue.push(`${text}\n`);
        }
    });
    ws.on("close", () => {
        clients.delete(ws);
        console.log(`[server] WebSocket client disconnected (remaining: ${clients.size})`);
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
    console.log(`[server] base path: ${BASE_PATH}`);
    console.log(`[server] pi path: ${PI_PATH}`);
    console.log(`[server] workdir: ${PI_WORKDIR}`);
    console.log(`[server] static: ${PUBLIC_DIR}`);
    console.log(`[server] web sessions: ${WEB_SESSION_DIR}`);
    console.log(`[server] cli sessions: ${CLI_SESSION_DIR}`);
});
