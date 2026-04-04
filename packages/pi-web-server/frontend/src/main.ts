/**
 * pi-web-server frontend entry point.
 *
 * Creates a WebSocketAgent backed by the server-side pi-coding-agent process,
 * sets up the pi-web-ui ChatPanel, and renders the application.
 */

import "@mariozechner/mini-lit/dist/ThemeToggle.js";
import {
	AppStorage,
	ChatPanel,
	CustomProvidersStore,
	IndexedDBStorageBackend,
	ProviderKeysStore,
	SessionsStore,
	SettingsStore,
	setAppStorage,
} from "@mariozechner/pi-web-ui";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { WebSocketAgent } from "./ws-agent.js";
import "./app.css";

// ---------------------------------------------------------------------------
// Slash command system
// ---------------------------------------------------------------------------

interface SlashCommand {
	name: string;
	description: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
	{ name: "/new",        description: "Start a fresh conversation" },
	{ name: "/screenshot", description: "Take a screenshot and describe it" },
	{ name: "/help",       description: "Show available commands" },
];

/** Show a brief floating toast notification. */
function showToast(message: string, durationMs = 3500): void {
	const toast = document.createElement("div");
	toast.style.cssText = [
		"position:fixed",
		"bottom:90px",
		"left:50%",
		"transform:translateX(-50%)",
		"z-index:10001",
		"padding:10px 18px",
		"background:rgba(15,23,42,0.97)",
		"color:#e2e8f0",
		"border:1px solid rgba(100,116,139,0.4)",
		"border-radius:10px",
		"font:13px/1.6 system-ui,sans-serif",
		"white-space:pre-line",
		"max-width:440px",
		"text-align:left",
		"box-shadow:0 8px 24px rgba(0,0,0,0.5)",
		"pointer-events:none",
		"opacity:1",
		"transition:opacity 0.25s",
	].join(";");
	toast.textContent = message;
	document.body.appendChild(toast);
	setTimeout(() => {
		toast.style.opacity = "0";
		setTimeout(() => toast.remove(), 260);
	}, durationMs);
}

type PendingSessionAction = "new" | "load";

interface RemoteSessionSummary {
	fileName: string;
	sessionId: string;
	title: string;
	createdAt: string;
	lastModified: string;
	messageCount: number;
	preview: string;
	parentSession?: string;
}

let pendingSessionAction: PendingSessionAction | null = null;
let sessionHistoryOverlay: HTMLElement | null = null;
let sessionHistoryCleanup: (() => void) | undefined;

function formatRelativeTime(isoString: string): string {
	const date = new Date(isoString);
	const diffMs = Date.now() - date.getTime();
	const diffMinutes = Math.floor(diffMs / (1000 * 60));
	const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
	const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

	if (Number.isNaN(date.getTime())) return "unknown";
	if (diffMinutes < 1) return "just now";
	if (diffHours < 1) return `${diffMinutes}m ago`;
	if (diffDays < 1) return `${diffHours}h ago`;
	if (diffDays < 7) return `${diffDays}d ago`;
	return date.toLocaleDateString();
}

function closeSessionHistoryOverlay(): void {
	if (!sessionHistoryOverlay) return;
	sessionHistoryCleanup?.();
	sessionHistoryCleanup = undefined;
	sessionHistoryOverlay.remove();
	sessionHistoryOverlay = null;
}

function createSessionRow(session: RemoteSessionSummary, onSelect: () => void): HTMLElement {
	const row = document.createElement("button");
	row.type = "button";
	row.style.cssText = [
		"width:100%",
		"text-align:left",
		"padding:12px 14px",
		"border:1px solid var(--border)",
		"border-radius:12px",
		"background:var(--background)",
		"color:var(--foreground)",
		"cursor:pointer",
		"display:flex",
		"flex-direction:column",
		"gap:4px",
		"transition:background 0.15s,border-color 0.15s,transform 0.15s",
	].join(";");

	const title = document.createElement("div");
	title.style.cssText = "font:600 14px/1.3 system-ui,sans-serif;";
	title.textContent = session.title || session.sessionId;

	const meta = document.createElement("div");
	meta.style.cssText = "font:12px/1.4 ui-monospace,monospace;color:var(--muted-foreground);";
	meta.textContent = `${session.messageCount} messages · ${formatRelativeTime(session.lastModified)} · ${session.fileName}`;

	const preview = document.createElement("div");
	preview.style.cssText = "font:13px/1.4 system-ui,sans-serif;color:var(--muted-foreground);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
	preview.textContent = session.preview || "No preview available";

	row.appendChild(title);
	row.appendChild(meta);
	row.appendChild(preview);

	row.addEventListener("mouseenter", () => {
		row.style.background = "var(--accent, rgba(0,0,0,0.05))";
		row.style.borderColor = "var(--ring, var(--border))";
		row.style.transform = "translateY(-1px)";
	});
	row.addEventListener("mouseleave", () => {
		row.style.background = "var(--background)";
		row.style.borderColor = "var(--border)";
		row.style.transform = "translateY(0)";
	});
	row.addEventListener("click", onSelect);
	return row;
}

async function openSessionHistory(agentRef: WebSocketAgent): Promise<void> {
	closeSessionHistoryOverlay();

	const overlay = document.createElement("div");
	overlay.style.cssText = [
		"position:fixed",
		"inset:0",
		"z-index:10002",
		"background:rgba(15,23,42,0.72)",
		"display:flex",
		"align-items:center",
		"justify-content:center",
		"padding:24px",
	].join(";");

	const panel = document.createElement("div");
	panel.style.cssText = [
		"width:min(760px,100%)",
		"max-height:min(80vh,780px)",
		"background:var(--background)",
		"border:1px solid var(--border)",
		"border-radius:16px",
		"box-shadow:0 24px 60px rgba(0,0,0,0.35)",
		"display:flex",
		"flex-direction:column",
		"overflow:hidden",
	].join(";");

	const header = document.createElement("div");
	header.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 18px;border-bottom:1px solid var(--border);";

	const titleWrap = document.createElement("div");
	const title = document.createElement("div");
	title.style.cssText = "font:600 16px/1.2 system-ui,sans-serif;color:var(--foreground);";
	title.textContent = "Session history";
	const subtitle = document.createElement("div");
	subtitle.style.cssText = "margin-top:4px;font:13px/1.4 system-ui,sans-serif;color:var(--muted-foreground);";
	subtitle.textContent = "Load a previous server-side session";
	titleWrap.appendChild(title);
	titleWrap.appendChild(subtitle);

	const closeButton = document.createElement("button");
	closeButton.type = "button";
	closeButton.textContent = "Close";
	closeButton.style.cssText = [
		"border:1px solid var(--border)",
		"background:var(--background)",
		"color:var(--foreground)",
		"border-radius:10px",
		"padding:8px 12px",
		"cursor:pointer",
		"font:500 13px/1 system-ui,sans-serif",
	].join(";");
	closeButton.addEventListener("click", closeSessionHistoryOverlay);

	header.appendChild(titleWrap);
	header.appendChild(closeButton);

	const body = document.createElement("div");
	body.style.cssText = "padding:16px;overflow:auto;display:flex;flex-direction:column;gap:10px;";

	const status = document.createElement("div");
	status.style.cssText = "font:13px/1.4 system-ui,sans-serif;color:var(--muted-foreground);padding:4px 2px;";
	status.textContent = "Loading sessions…";
	body.appendChild(status);

	const list = document.createElement("div");
	list.style.cssText = "display:flex;flex-direction:column;gap:10px;";
	body.appendChild(list);

	const loadSessionRows = async () => {
		try {
			const response = await fetch("/api/sessions");
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}

			const sessions = (await response.json()) as RemoteSessionSummary[];
			list.innerHTML = "";
			if (!sessions.length) {
				status.textContent = "No saved sessions found yet.";
				return;
			}

			status.textContent = `${sessions.length} session${sessions.length === 1 ? "" : "s"} available`;
			for (const session of sessions) {
				list.appendChild(
					createSessionRow(session, () => {
						pendingSessionAction = "load";
						showToast(`Loading ${session.title || session.sessionId}…`);
						agentRef.loadSession(session.fileName);
						closeSessionHistoryOverlay();
					}),
				);
			}
		} catch (error) {
			console.error("Failed to load session history:", error);
			status.textContent = `Failed to load sessions: ${String(error)}`;
		}
	};

	const footer = document.createElement("div");
	footer.style.cssText = "display:flex;justify-content:space-between;gap:12px;padding:12px 18px;border-top:1px solid var(--border);font:12px/1.4 ui-monospace,monospace;color:var(--muted-foreground);";
	const current = document.createElement("div");
	current.textContent = `Current session: ${agentRef.sessionFile?.split("/").pop() ?? "live"}`;
	const refresh = document.createElement("button");
	refresh.type = "button";
	refresh.textContent = "Refresh";
	refresh.style.cssText = "border:none;background:transparent;color:var(--foreground);cursor:pointer;font:inherit;padding:0;";
	refresh.addEventListener("click", () => void loadSessionRows());
	footer.appendChild(current);
	footer.appendChild(refresh);

	panel.appendChild(header);
	panel.appendChild(body);
	panel.appendChild(footer);
	overlay.appendChild(panel);
	overlay.addEventListener("click", (event) => {
		if (event.target === overlay) closeSessionHistoryOverlay();
	});
	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key === "Escape") {
			closeSessionHistoryOverlay();
		}
	};
	document.addEventListener("keydown", onKeyDown);
	sessionHistoryCleanup = () => document.removeEventListener("keydown", onKeyDown);

	document.body.appendChild(overlay);
	sessionHistoryOverlay = overlay;
	await loadSessionRows();
}

function createHeader(agentRef: WebSocketAgent): HTMLElement {
	const header = document.createElement("header");
	header.id = "app-header";
	header.style.cssText = [
		"flex:0 0 auto",
		"display:flex",
		"align-items:center",
		"justify-content:space-between",
		"height:52px",
		"padding:0 16px",
		"border-bottom:1px solid var(--border)",
		"background:var(--background)",
		"position:relative",
		"z-index:100",
	].join(";");

	// Logo
	const logo = document.createElement("div");
	logo.style.cssText = "display:flex;align-items:baseline;gap:0;user-select:none;";
	logo.innerHTML = [
		'<span style="font-size:22px;font-weight:700;color:var(--foreground);letter-spacing:-0.5px;line-height:1">π</span>',
		'<span style="font-size:15px;font-weight:400;color:var(--muted-foreground);margin-left:5px;letter-spacing:0.01em">pi</span>',
	].join("");

	// Hamburger button
	const hamburgerBtn = document.createElement("button");
	hamburgerBtn.setAttribute("aria-label", "Open menu");
	hamburgerBtn.style.cssText = [
		"display:flex",
		"flex-direction:column",
		"justify-content:center",
		"align-items:center",
		"gap:4px",
		"width:36px",
		"height:36px",
		"border:none",
		"background:transparent",
		"cursor:pointer",
		"border-radius:6px",
		"padding:6px",
		"color:var(--foreground)",
		"transition:background 0.15s",
	].join(";");
	hamburgerBtn.innerHTML = [
		'<span style="display:block;width:18px;height:2px;background:currentColor;border-radius:1px"></span>',
		'<span style="display:block;width:18px;height:2px;background:currentColor;border-radius:1px"></span>',
		'<span style="display:block;width:18px;height:2px;background:currentColor;border-radius:1px"></span>',
	].join("");
	hamburgerBtn.addEventListener("mouseenter", () => { hamburgerBtn.style.background = "var(--accent, rgba(0,0,0,0.08))"; });
	hamburgerBtn.addEventListener("mouseleave", () => { hamburgerBtn.style.background = "transparent"; });

	// Dropdown menu
	const menu = document.createElement("div");
	menu.style.cssText = [
		"position:absolute",
		"top:calc(100% + 4px)",
		"right:12px",
		"min-width:220px",
		"background:var(--background)",
		"border:1px solid var(--border)",
		"border-radius:10px",
		"box-shadow:0 8px 24px rgba(0,0,0,0.15)",
		"z-index:10000",
		"overflow:hidden",
		"display:none",
		"padding:4px 0",
	].join(";");

	function menuItem(label: string, onClick: () => void): HTMLElement {
		const item = document.createElement("button");
		item.textContent = label;
		item.style.cssText = [
			"display:block",
			"width:100%",
			"text-align:left",
			"padding:10px 16px",
			"border:none",
			"background:transparent",
			"cursor:pointer",
			"font:14px/1.5 system-ui,sans-serif",
			"color:var(--foreground)",
			"transition:background 0.1s",
		].join(";");
		item.addEventListener("mouseenter", () => { item.style.background = "var(--accent, rgba(0,0,0,0.06))"; });
		item.addEventListener("mouseleave", () => { item.style.background = "transparent"; });
		item.addEventListener("click", () => { closeMenu(); onClick(); });
		return item;
	}

	function menuDivider(): HTMLElement {
		const hr = document.createElement("div");
		hr.style.cssText = "height:1px;background:var(--border);margin:4px 0;";
		return hr;
	}

	// New conversation
	const newConvBtn = menuItem("New conversation", () => {
		pendingSessionAction = "new";
		showToast("Starting fresh backend session…");
		agentRef.clearMessages();
		agentRef.newSession();
	});

	// Session history
	const historyBtn = menuItem("Session history", () => {
		void openSessionHistory(agentRef);
	});

	// Theme toggle row
	const themeRow = document.createElement("div");
	themeRow.style.cssText = [
		"display:flex",
		"align-items:center",
		"justify-content:space-between",
		"padding:8px 16px",
		"font:14px/1.5 system-ui,sans-serif",
		"color:var(--foreground)",
	].join(";");
	const themeLabel = document.createElement("span");
	themeLabel.textContent = "Theme";
	const themeToggleEl = document.createElement("theme-toggle");
	themeRow.appendChild(themeLabel);
	themeRow.appendChild(themeToggleEl);

	// Session / model info rows
	const sessionRow = document.createElement("div");
	sessionRow.style.cssText = [
		"padding:4px 16px 0",
		"font:11px/1.5 ui-monospace,monospace",
		"color:var(--muted-foreground)",
	].join(";");
	sessionRow.textContent = `Session: ${agentRef.sessionFile?.split("/").pop() ?? "live"}`;

	const modelRow = document.createElement("div");
	modelRow.style.cssText = [
		"padding:2px 16px 10px",
		"font:11px/1.5 ui-monospace,monospace",
		"color:var(--muted-foreground)",
	].join(";");
	modelRow.textContent = "Model: —";

	menu.appendChild(newConvBtn);
	menu.appendChild(historyBtn);
	menu.appendChild(menuDivider());
	menu.appendChild(themeRow);
	menu.appendChild(sessionRow);
	menu.appendChild(modelRow);

	let menuOpen = false;

	function openMenu(): void {
		menu.style.display = "block";
		menuOpen = true;
		sessionRow.textContent = `Session: ${agentRef.sessionFile?.split("/").pop() ?? "live"}`;
		const m = agentRef.state.model;
		modelRow.textContent = m ? `Model: ${m.provider}/${m.id}` : "Model: —";
	}

	function closeMenu(): void {
		menu.style.display = "none";
		menuOpen = false;
	}

	hamburgerBtn.addEventListener("click", (e) => {
		e.stopPropagation();
		menuOpen ? closeMenu() : openMenu();
	});

	document.addEventListener("click", (e) => {
		if (menuOpen && !menu.contains(e.target as Node) && e.target !== hamburgerBtn) {
			closeMenu();
		}
	});

	header.appendChild(logo);
	header.appendChild(hamburgerBtn);
	header.appendChild(menu);
	return header;
}

function formatTokens(count: number): string {
	if (count < 1000) return `${count}`;
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

function extractText(value: unknown): string {
	if (typeof value === "string") return value;
	if (!Array.isArray(value)) return "";
	return value
		.map((part) => {
			if (!part || typeof part !== "object") return "";
			const item = part as Record<string, unknown>;
			if (typeof item.text === "string") return item.text;
			if (typeof item.thinking === "string") return item.thinking;
			if (typeof item.name === "string") return item.name;
			if (item.arguments && typeof item.arguments === "object") return JSON.stringify(item.arguments);
			return "";
		})
		.filter(Boolean)
		.join(" ");
}

function estimateMessageTokens(message: AgentMessage): number {
	const content = (message as { content?: unknown }).content;
	const text = extractText(content);
	if (!text) return 0;
	return Math.max(1, Math.ceil(text.length / 4));
}

function estimateContextUsage(messages: AgentMessage[], contextWindow: number): { tokens: number | null; contextWindow: number; percent: number | null } {
	let lastUsageIndex = -1;
	let usageTokens = 0;

	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i] as { role?: string; usage?: { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens?: number } };
		if (msg.role === "assistant" && msg.usage && msg.usage.input >= 0) {
			lastUsageIndex = i;
			usageTokens = msg.usage.totalTokens ?? msg.usage.input + msg.usage.output + msg.usage.cacheRead + msg.usage.cacheWrite;
			break;
		}
	}

	if (lastUsageIndex === -1) {
		let estimated = 0;
		for (const message of messages) {
			estimated += estimateMessageTokens(message);
		}
		return {
			tokens: estimated,
			contextWindow,
			percent: contextWindow > 0 ? (estimated / contextWindow) * 100 : null,
		};
	}

	let trailingTokens = 0;
	for (let i = lastUsageIndex + 1; i < messages.length; i++) {
		trailingTokens += estimateMessageTokens(messages[i]);
	}

	const tokens = usageTokens + trailingTokens;
	return {
		tokens,
		contextWindow,
		percent: contextWindow > 0 ? (tokens / contextWindow) * 100 : null,
	};
}

function formatUsageLine(messages: AgentMessage[], model?: { provider: string; id: string; contextWindow?: number }): string {
	const totals = messages.reduce(
		(acc, msg) => {
			const usage = (msg as { role?: string; usage?: { input: number; output: number; cacheRead: number; cacheWrite: number; cost?: { total: number } } }).usage;
			if (msg.role === "assistant" && usage) {
				acc.input += usage.input;
				acc.output += usage.output;
				acc.cacheRead += usage.cacheRead;
				acc.cacheWrite += usage.cacheWrite;
				acc.cost += usage.cost?.total ?? 0;
			}
			return acc;
		},
		{ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
	);

	const contextWindow = model?.contextWindow ?? 0;
	const contextUsage = estimateContextUsage(messages, contextWindow);
	const contextPart =
		contextUsage.tokens === null
			? `ctx ?/${formatTokens(contextWindow)}`
			: contextUsage.percent === null
				? `ctx ${formatTokens(contextUsage.tokens)}/${formatTokens(contextWindow)}`
				: `ctx ${formatTokens(contextUsage.tokens)}/${formatTokens(contextWindow)} (${contextUsage.percent.toFixed(1)}%)`;

	const stats = [
		totals.input ? `↑${formatTokens(totals.input)}` : "↑0",
		totals.output ? `↓${formatTokens(totals.output)}` : "↓0",
		totals.cacheRead ? `R${formatTokens(totals.cacheRead)}` : "R0",
		totals.cacheWrite ? `W${formatTokens(totals.cacheWrite)}` : "W0",
		`$${totals.cost.toFixed(3)}`,
		contextPart,
	];

	if (model) {
		stats.push(`${model.provider}/${model.id}`);
	}

	return stats.join("  ");
}

function createUsageFooter(): HTMLElement {
	const footer = document.createElement("div");
	footer.className = "shrink-0 border-t border-border bg-background/95 px-4 py-1 text-xs text-muted-foreground";
	footer.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';
	footer.textContent = "usage: ...";
	return footer;
}

/** Execute a slash command. Returns true if the input was consumed. */
function executeSlashCommand(agentRef: WebSocketAgent, cmd: string): boolean {
	const name = cmd.trim().split(/\s+/)[0].toLowerCase();
	switch (name) {
		case "/new":
			agentRef.clearMessages();
			agentRef.newSession();
			showToast("✓ New conversation started");
			return true;
		case "/help":
			showToast(
				"Available commands:\n" +
				SLASH_COMMANDS.map(c => `  ${c.name}  —  ${c.description}`).join("\n"),
				6000,
			);
			return true;
		case "/screenshot":
			void agentRef.prompt("take a screenshot of the current screen and describe what you see");
			return true;
		default:
			showToast(`Unknown command: ${name}\nType /help to see available commands`, 4000);
			return true; // consume it so it doesn't get sent to the agent verbatim
	}
}

/** Recursively search for a textarea, including inside shadow roots. */
function findTextarea(root: Document | ShadowRoot | Element): HTMLTextAreaElement | null {
	const el = (root as Element | Document).querySelector?.("textarea");
	if (el) return el as HTMLTextAreaElement;
	const children = (root as Element | Document).querySelectorAll?.("*") ?? [];
	for (const child of Array.from(children)) {
		const sr = (child as Element).shadowRoot;
		if (sr) {
			const found = findTextarea(sr);
			if (found) return found;
		}
	}
	return null;
}

/** Attach keyboard-driven autocomplete dropdown to the chat textarea. */
function attachAutocomplete(textarea: HTMLTextAreaElement): void {
	const dropdown = document.createElement("div");
	dropdown.style.cssText = [
		"position:fixed",
		"z-index:10000",
		"background:rgba(15,23,42,0.97)",
		"border:1px solid rgba(100,116,139,0.35)",
		"border-radius:10px",
		"overflow:hidden",
		"box-shadow:0 8px 24px rgba(0,0,0,0.5)",
		"display:none",
		"min-width:340px",
		"font:14px/1 system-ui,sans-serif",
	].join(";");
	document.body.appendChild(dropdown);

	let selectedIdx = 0;
	let currentMatches: SlashCommand[] = [];

	function hide() { dropdown.style.display = "none"; }

	function render(value: string): void {
		const token = value.split(/\s/)[0].toLowerCase();
		if (!token.startsWith("/")) { hide(); return; }
		currentMatches = SLASH_COMMANDS.filter(c => c.name.startsWith(token));
		if (!currentMatches.length) { hide(); return; }
		selectedIdx = Math.max(0, Math.min(selectedIdx, currentMatches.length - 1));

		const rect = textarea.getBoundingClientRect();
		dropdown.style.bottom = `${window.innerHeight - rect.top + 6}px`;
		dropdown.style.left = `${rect.left}px`;
		dropdown.style.display = "block";

		dropdown.innerHTML = currentMatches.map((c, i) => `
			<div data-idx="${i}" style="
				padding:10px 14px;cursor:pointer;display:flex;align-items:center;gap:14px;
				background:${i === selectedIdx ? "rgba(51,65,85,0.9)" : "transparent"};
				${i < currentMatches.length - 1 ? "border-bottom:1px solid rgba(100,116,139,0.2);" : ""}
			">
				<span style="font-weight:600;color:#93c5fd;font-family:monospace;font-size:13px;min-width:110px">${c.name}</span>
				<span style="color:#94a3b8;font-size:13px">${c.description}</span>
			</div>
		`).join("");

		dropdown.querySelectorAll<HTMLElement>("[data-idx]").forEach(item => {
			item.addEventListener("mousedown", e => {
				e.preventDefault();
				apply(currentMatches[parseInt(item.dataset.idx!, 10)].name);
			});
		});
	}

	function apply(name: string): void {
		const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
		setter ? setter.call(textarea, name) : (textarea.value = name);
		textarea.dispatchEvent(new Event("input", { bubbles: true }));
		textarea.dispatchEvent(new Event("change", { bubbles: true }));
		textarea.focus();
		hide();
	}

	textarea.addEventListener("input", () => { selectedIdx = 0; render(textarea.value); });
	textarea.addEventListener("keydown", (e: KeyboardEvent) => {
		if (dropdown.style.display === "none") return;
		if (e.key === "ArrowDown") {
			e.preventDefault();
			selectedIdx = (selectedIdx + 1) % currentMatches.length;
			render(textarea.value);
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			selectedIdx = (selectedIdx - 1 + currentMatches.length) % currentMatches.length;
			render(textarea.value);
		} else if (e.key === "Tab" && currentMatches.length) {
			e.preventDefault();
			apply(currentMatches[selectedIdx].name);
		} else if (e.key === "Escape") {
			hide();
		}
	});
	textarea.addEventListener("blur", () => setTimeout(hide, 150));
}

/** Poll until the chat textarea is available, then attach autocomplete. */
function setupAutocomplete(chatEl: HTMLElement): void {
	let attempts = 0;
	const interval = setInterval(() => {
		const textarea = findTextarea(chatEl) ?? findTextarea(document);
		if (textarea) {
			clearInterval(interval);
			attachAutocomplete(textarea);
			console.log("[slash] Autocomplete attached to chat textarea");
		} else if (++attempts > 30) {
			clearInterval(interval);
			console.warn("[slash] Could not find chat textarea for autocomplete after 6s");
		}
	}, 200);
}

// ---------------------------------------------------------------------------
// App storage — required by AgentInterface internals (proxy settings, keys store)
// We don't use any LLM API keys; onApiKeyRequired always returns true to bypass
// the API key check in AgentInterface.sendMessage().
// ---------------------------------------------------------------------------

const settings = new SettingsStore();
const providerKeys = new ProviderKeysStore();
const sessions = new SessionsStore();
const customProviders = new CustomProvidersStore();

const backend = new IndexedDBStorageBackend({
	dbName: "pi-web-server",
	version: 1,
	stores: [
		settings.getConfig(),
		SessionsStore.getMetadataConfig(),
		providerKeys.getConfig(),
		customProviders.getConfig(),
		sessions.getConfig(),
	],
});

settings.setBackend(backend);
providerKeys.setBackend(backend);
customProviders.setBackend(backend);
sessions.setBackend(backend);

setAppStorage(new AppStorage(settings, providerKeys, sessions, customProviders, backend));

// ---------------------------------------------------------------------------
// Create agent + UI
// ---------------------------------------------------------------------------

// Redirect shorthand entrypoints to the default chat session.
const DEFAULT_SESSION = "agent:main:main";
const pathname = window.location.pathname.replace(/\/+$/, "");
if (pathname === "/pi" || pathname === "") {
	const prefix = pathname === "/pi" ? "/pi" : "";
	window.location.replace(`${prefix}/chat?session=${encodeURIComponent(DEFAULT_SESSION)}`);
}

// Use wss:// when the page is served over HTTPS (e.g. via Tailscale), ws:// otherwise
const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const wsUrl = new URL("ws", window.location.href);
wsUrl.protocol = wsProtocol;
const agent = new WebSocketAgent(wsUrl.toString());
const chatPanel = new ChatPanel();

// Wrap agent.prompt to intercept slash commands before they reach the server
const _originalPrompt = agent.prompt.bind(agent);
agent.prompt = async (input: Parameters<typeof agent.prompt>[0], images?: Parameters<typeof agent.prompt>[1]) => {
	let text = "";
	if (typeof input === "string") {
		text = input;
	} else if (Array.isArray(input)) {
		text = (input as any[])
			.map((m: any) => {
				if (typeof m?.content === "string") return m.content as string;
				if (Array.isArray(m?.content))
					return (m.content as any[]).filter((c: any) => c.type === "text").map((c: any) => c.text ?? "").join(" ");
				return "";
			})
			.filter(Boolean)
			.join("\n");
	} else if (input && typeof (input as any).content === "string") {
		text = (input as any).content as string;
	}
	if (text.trimStart().startsWith("/")) {
		if (executeSlashCommand(agent, text.trim())) return;
	}
	return _originalPrompt(input, images);
};

// ---------------------------------------------------------------------------
// Connection status banner
// ---------------------------------------------------------------------------

function createStatusBanner(): HTMLElement {
	const banner = document.createElement("div");
	banner.style.cssText = [
		"flex:0 0 auto",
		"padding:8px 16px",
		"background:#b45309",
		"color:#fff",
		"font:13px/1.4 system-ui,sans-serif",
		"text-align:center",
		"display:none",
	].join(";");
	banner.textContent = "Disconnected — reconnecting to agent…";
	return banner;
}

async function init() {
	const app = document.getElementById("app");
	if (!app) throw new Error("#app not found");

	app.style.cssText = "width:100%;height:100vh;display:flex;flex-direction:column;overflow:hidden;";

	const header = createHeader(agent);
	const banner = createStatusBanner();
	const usageFooter = createUsageFooter();

	agent.onConnectionChange = (connected) => {
		banner.style.display = connected ? "none" : "block";
	};

	agent.onSessionCleared = () => {
		if (pendingSessionAction === "new") {
			showToast("Fresh backend session ready");
		} else if (pendingSessionAction === "load") {
			showToast("Session loaded");
		} else {
			showToast("Backend session reset");
		}
		pendingSessionAction = null;
	};

	agent.onServerError = (message) => {
		if (pendingSessionAction) {
			pendingSessionAction = null;
		}
		if (message.includes("Invalid session file")) {
			showToast(message, 5000);
		}
	};

	// Show disconnected immediately (WS hasn't opened yet)
	banner.style.display = "block";

	await chatPanel.setAgent(agent as any, {
		// The coding agent has its own API keys; bypass the browser-side key check
		onApiKeyRequired: () => Promise.resolve(true),
	});

	chatPanel.style.flex = "1 1 auto";
	chatPanel.style.minHeight = "0";
	chatPanel.style.height = "auto";

	const workspace = document.createElement("div");
	workspace.style.cssText = "flex:1 1 auto;min-height:0;display:flex;flex-direction:column;";
	workspace.appendChild(chatPanel);
	app.appendChild(header);
	app.appendChild(banner);
	app.appendChild(workspace);
	app.appendChild(usageFooter);

	const syncUsageFooter = () => {
		usageFooter.textContent = formatUsageLine(agent.state.messages, agent.state.model);
	};

	syncUsageFooter();
	agent.subscribe(() => syncUsageFooter());
	window.setInterval(syncUsageFooter, 1000);

	// Attach slash command autocomplete once the ChatPanel textarea is rendered
	setupAutocomplete(chatPanel);
}

document.addEventListener("DOMContentLoaded", () => {
	init().catch(console.error);
});
