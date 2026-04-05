# pi-web-server

A lightweight HTTP + WebSocket server that bridges a browser UI to the [pi coding agent](https://github.com/anthropics/pi) CLI.

## What it does

- Serves the compiled frontend from `dist/public/`
- Maintains **one persistent `pi` process** shared across all browser tabs
- Streams agent output (JSONL) to all connected WebSocket clients
- Forwards browser messages to agent stdin
- Auto-restarts the agent if it exits, and replays queued messages on reconnect
- Exposes a session switcher so you can load any past web or CLI session

## Prerequisites

- Node.js 18+
- The `pi` CLI installed (default path: `/opt/homebrew/bin/pi`)
- (Optional) [Tailscale](https://tailscale.com/) for remote access

## Setup

```bash
npm install
cp .env.example .env
# Edit .env with your paths
npm run dev
```

The server defaults to `http://localhost:8484` and serves the app at `/pi/`.

## Environment variables

| Variable         | Default                                    | Description                                      |
|------------------|--------------------------------------------|--------------------------------------------------|
| `PORT`           | `8484`                                     | HTTP port                                        |
| `PI_PATH`        | `/opt/homebrew/bin/pi`                     | Path to the pi CLI binary                        |
| `PI_WORKDIR`     | `$HOME`                                    | Working directory for the agent process          |
| `BASE_PATH`      | `/pi`                                      | URL prefix (e.g. `/pi` → app served at `/pi/`)   |
| `WEB_SESSION_DIR`| `~/.pi/agent/sessions/web`                 | Where web UI sessions are stored                 |
| `CLI_SESSION_DIR`| `~/.pi/agent/sessions/--Users-yourname--`  | CLI session dir shown in session switcher        |
| `SYSTEM_PROMPT`  | *(built-in default)*                       | System prompt injected on agent spawn            |

## Tailscale Serve

To expose the server over Tailscale, configure Tailscale Serve to proxy to the local port:

```bash
tailscale serve https / http://localhost:8484
```

Then access at `https://<your-machine>.tail<id>.ts.net/`.

## Single-process design

All browser tabs share one agent process. This means the agent's context is continuous regardless of which tab is open — ideal for a personal assistant running on a home server or Mac mini. The session switcher lets you resume any past conversation (web or CLI) by respawning the agent with that session file.
