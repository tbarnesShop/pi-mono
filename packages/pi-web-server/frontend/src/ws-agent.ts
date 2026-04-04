/**
 * WebSocketAgent — a duck-type-compatible proxy for pi-agent-core's Agent class
 * that communicates with pi-coding-agent via WebSocket → server → JSONL RPC.
 *
 * The server bridges WebSocket messages to the agent's stdin/stdout.
 * Each WS message sent = one JSON RPC command; each WS message received = one JSON line from stdout.
 */

import type { AgentEvent, AgentMessage, AgentState, AgentTool, ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { ImageContent, Model } from "@mariozechner/pi-ai";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractText(msg: any): string {
	if (!msg) return "";
	if (typeof msg.content === "string") return msg.content;
	if (Array.isArray(msg.content)) {
		return msg.content
			.filter((c: any) => c.type === "text")
			.map((c: any) => c.text ?? "")
			.join("\n");
	}
	return "";
}

const PLACEHOLDER_MODEL: Model<any> = {
	provider: "websocket",
	id: "pi-coding-agent",
	contextWindow: 200000,
} as any;

// ---------------------------------------------------------------------------
// WebSocketAgent
// ---------------------------------------------------------------------------

export class WebSocketAgent {
	// AgentInterface reads these two properties directly
	streamFn: any = (): never => {
		throw new Error("not used");
	};
	getApiKey: ((provider: string) => Promise<string | undefined> | string | undefined) | undefined = undefined;

	/** Called whenever the WebSocket connection opens or closes. */
	onConnectionChange?: (connected: boolean) => void;
	/** Called after the server has reset or switched to a new session. */
	onSessionCleared?: () => void;
	/** Called when the server reports a recoverable error. */
	onServerError?: (message: string) => void;

	private _state: AgentState = {
		systemPrompt: "",
		model: PLACEHOLDER_MODEL,
		thinkingLevel: "off",
		tools: [],
		messages: [],
		isStreaming: false,
		streamMessage: null,
		pendingToolCalls: new Set<string>(),
	};

	private _listeners = new Set<(e: AgentEvent) => void>();
	private _ws!: WebSocket;
	private _wsUrl: string;
	private _connected = false;
	private _destroyed = false;
	private _sessionFile: string | undefined;

	constructor(wsUrl: string) {
		this._wsUrl = wsUrl;
		this._connect();
	}

	get connected(): boolean {
		return this._connected;
	}

	get sessionFile(): string | undefined {
		return this._sessionFile;
	}

	// -------------------------------------------------------------------------
	// Core interface
	// -------------------------------------------------------------------------

	get state(): AgentState {
		return this._state;
	}

	subscribe(fn: (e: AgentEvent) => void): () => void {
		this._listeners.add(fn);
		return () => this._listeners.delete(fn);
	}

	// Accepts string, AgentMessage, or AgentMessage[] — extracts text for RPC
	async prompt(input: string | AgentMessage | AgentMessage[], _images?: ImageContent[]): Promise<void> {
		let text: string;
		if (typeof input === "string") {
			text = input;
		} else if (Array.isArray(input)) {
			text = input.map(extractText).filter(Boolean).join("\n");
		} else {
			text = extractText(input);
		}

		// Don't preemptively set isStreaming — let the server's agent_start event drive it.
		// This prevents the UI from getting stuck if the WS is closed or the send fails.
		if (!this._send({ type: "prompt", message: text })) {
			console.warn("[ws-agent] prompt dropped — not connected");
		}
	}

	steer(msg: AgentMessage): void {
		const text = extractText(msg);
		if (text) this._send({ type: "steer", message: text });
	}

	followUp(msg: AgentMessage): void {
		const text = extractText(msg);
		if (text) this._send({ type: "follow_up", message: text });
	}

	abort(): void {
		this._send({ type: "abort" });
	}

	/** Start a fresh session: kills and restarts the agent process on the server. */
	newSession(): void {
		this._send({ type: "new_session" });
	}

	/** Load an existing session transcript on the server and reconnect the agent to it. */
	loadSession(sessionFile: string): void {
		this._send({ type: "load_session", sessionFile });
	}

	setModel(model: Model<any>): void {
		this._setState({ model });
		this._send({ type: "set_model", provider: model.provider, modelId: model.id });
	}

	setThinkingLevel(level: ThinkingLevel): void {
		this._setState({ thinkingLevel: level });
		this._send({ type: "set_thinking_level", level });
	}

	setTools(tools: AgentTool<any>[]): void {
		this._setState({ tools });
	}

	// -------------------------------------------------------------------------
	// Stubs — not used by our WebSocket backend but required by the Agent shape
	// -------------------------------------------------------------------------

	setSystemPrompt(_v: string): void {}
	setSteeringMode(_mode: "all" | "one-at-a-time"): void {}
	getSteeringMode(): "all" | "one-at-a-time" {
		return "one-at-a-time";
	}
	setFollowUpMode(_mode: "all" | "one-at-a-time"): void {}
	getFollowUpMode(): "all" | "one-at-a-time" {
		return "one-at-a-time";
	}
	replaceMessages(ms: AgentMessage[]): void {
		this._setState({ messages: ms.slice() });
	}
	appendMessage(m: AgentMessage): void {
		this._setState({ messages: [...this._state.messages, m] });
	}
	clearSteeringQueue(): void {}
	clearFollowUpQueue(): void {}
	clearAllQueues(): void {}
	hasQueuedMessages(): boolean {
		return false;
	}
	clearMessages(): void {
		this._setState({ messages: [] });
	}
	waitForIdle(): Promise<void> {
		return Promise.resolve();
	}
	reset(): void {
		this._sessionFile = undefined;
		this._setState({
			messages: [],
			isStreaming: false,
			streamMessage: null,
			pendingToolCalls: new Set<string>(),
		});
	}
	async continue(): Promise<void> {}

	// -------------------------------------------------------------------------
	// Internal
	// -------------------------------------------------------------------------

	private _connect(): void {
		if (this._destroyed) return;

		const ws = new WebSocket(this._wsUrl);
		this._ws = ws;

		ws.addEventListener("open", () => {
			console.log("[ws-agent] connected");
			this._connected = true;
			this.onConnectionChange?.(true);
			this._send({ type: "get_state" });
		});

		ws.addEventListener("message", (event) => {
			try {
				const data = JSON.parse(event.data as string);
				this._handleMessage(data);
			} catch {
				// ignore non-JSON
			}
		});

		ws.addEventListener("close", () => {
			console.log("[ws-agent] connection closed — reconnecting in 2s");
			this._connected = false;
			// Reset any in-progress streaming so the UI isn't stuck
			this._setState({ isStreaming: false, streamMessage: null, pendingToolCalls: new Set<string>() });
			this.onConnectionChange?.(false);
			setTimeout(() => this._connect(), 2000);
		});

		ws.addEventListener("error", (err) => {
			console.error("[ws-agent] error", err);
			// close event fires after error, which handles reconnect
		});
	}

	private _setState(patch: Partial<AgentState>): void {
		this._state = { ...this._state, ...patch };
	}

	private _emit(event: AgentEvent): void {
		for (const listener of this._listeners) {
			listener(event);
		}
	}

	/** Returns true if the message was sent, false if the socket wasn't open. */
	private _send(cmd: Record<string, unknown>): boolean {
		if (this._ws.readyState === WebSocket.OPEN) {
			this._ws.send(JSON.stringify(cmd));
			return true;
		}
		return false;
	}

	private _handleMessage(data: any): void {
		// RPC responses
		if (data.type === "response") {
			if (data.command === "new_session" && data.success) {
				if (data.data?.cancelled) {
					return;
				}
				this.reset();
				this._sessionFile = undefined;
				this.onSessionCleared?.();
				this._send({ type: "get_state" });
				return;
			}
			if (data.command === "switch_session" && data.success) {
				if (data.data?.cancelled) {
					return;
				}
				this.onSessionCleared?.();
				this._send({ type: "get_state" });
				return;
			}
			if (data.command === "get_state" && data.success && data.data) {
				const s = data.data;
				const patch: Partial<AgentState> = {};
				if (s.model) patch.model = s.model;
				if (s.thinkingLevel) patch.thinkingLevel = s.thinkingLevel;
				if (typeof s.isStreaming === "boolean") patch.isStreaming = s.isStreaming;
				if (typeof s.sessionFile === "string") {
					this._sessionFile = s.sessionFile;
				}
				this._setState(patch);
			}
			return;
		}

		// Server confirmed session was cleared — reset local state
		if (data.type === "session_cleared") {
			this.reset();
			this.onSessionCleared?.();
			return;
		}

		// Restore prior transcript on fresh connection or after a session switch
		if (data.type === "session_snapshot") {
			this._sessionFile = typeof data.sessionFile === "string" ? data.sessionFile : undefined;
			const msgs = (data.messages ?? []) as AgentMessage[];
			this._setState({ messages: msgs });
			// emit agent_end so UI subscribers re-render with the restored messages
			this._processEvent({ type: "agent_end" } as AgentEvent);
			return;
		}

		// Extension UI requests — respond with cancelled so the agent isn't stuck
		if (data.type === "extension_ui_request") {
			this._send({ type: "extension_ui_response", id: data.id, cancelled: true });
			return;
		}

		// Server-side error (e.g. agent exited with non-zero code)
		if (data.type === "server_error") {
			console.error("[ws-agent] server error:", data.message);
			if (typeof data.message === "string") {
				this.onServerError?.(data.message);
			}
			return;
		}

		// Agent events — process and forward to UI subscribers
		this._processEvent(data as AgentEvent);
	}

	private _processEvent(event: AgentEvent): void {
		switch (event.type) {
			case "agent_start":
				this._setState({ isStreaming: true });
				break;

			case "message_start":
				this._setState({ isStreaming: true, streamMessage: (event as any).message });
				break;

			case "message_update":
				this._setState({ streamMessage: (event as any).message });
				break;

			case "message_end": {
				const msg = (event as any).message as AgentMessage;
				this._setState({
					streamMessage: null,
					messages: [...this._state.messages, msg],
				});
				break;
			}

			case "tool_execution_start": {
				const pending = new Set(this._state.pendingToolCalls);
				pending.add((event as any).toolCallId);
				this._setState({ pendingToolCalls: pending });
				break;
			}

			case "tool_execution_end": {
				const pending = new Set(this._state.pendingToolCalls);
				pending.delete((event as any).toolCallId);
				this._setState({ pendingToolCalls: pending });
				break;
			}

			case "agent_end":
				this._setState({
					isStreaming: false,
					streamMessage: null,
					pendingToolCalls: new Set<string>(),
				});
				break;
		}

		this._emit(event);
	}
}
