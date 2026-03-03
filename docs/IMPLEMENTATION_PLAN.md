# Terminal Bridge — Implementation Plan

## 1. Project Overview

**Goal:** A web application that lets you remotely control a Claude Code (or Codex) terminal session running on your Mac Mini server from any browser — phone, laptop, iPad — anywhere.

**Core mechanic:** A Node.js server on the Mac Mini spawns Claude Code inside a real pseudo-terminal (PTY), then bridges that PTY over WebSocket to a React frontend that renders the full TUI using xterm.js. Keystrokes flow back through the same channel. tmux wraps the session so it survives disconnects.

---

## 2. Technology Stack

| Layer                   | Technology                                                         | Why                                                                                                   |
| ----------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| **Runtime**             | Node.js 18+                                                        | Best ecosystem for PTY + WebSocket libraries                                                          |
| **Language**            | TypeScript (strict mode)                                           | Type safety across client and server                                                                  |
| **Server framework**    | Express 4.x                                                        | Lightweight, serves static files + health endpoint                                                    |
| **WebSocket**           | `ws` 8.x                                                           | De facto Node.js WebSocket library, no bloat                                                          |
| **PTY**                 | `node-pty` 1.x                                                     | Calls `forkpty()` on macOS — gives Claude Code a real TTY                                             |
| **Session persistence** | tmux                                                               | Survives WebSocket drops, multi-window support                                                        |
| **Frontend framework**  | React 19 + Vite 7                                                  | Fast builds, HMR in dev, proven stack                                                                 |
| **Terminal emulator**   | xterm.js 5.x (`@xterm/xterm`)                                      | Industry-standard browser terminal, renders ANSI perfectly                                            |
| **xterm addons**        | `@xterm/addon-fit`, `@xterm/addon-web-links`, `@xterm/addon-webgl` | Auto-resize, clickable URLs, GPU-accelerated rendering                                                |
| **Styling**             | Plain CSS (dark terminal theme)                                    | Minimal, purpose-built — no framework overhead needed                                                 |
| **Linting**             | ESLint 9 (flat config) + `typescript-eslint`                       | Matches jewel-thief-safehouse setup                                                                   |
| **Formatting**          | Prettier 3.x                                                       | Matches jewel-thief-safehouse config (4-space indent, single quotes, 140 char width, trailing commas) |
| **Remote access**       | Tailscale                                                          | Private mesh VPN, no port forwarding, built-in TLS certs                                              |
| **Persistence**         | macOS LaunchAgent                                                  | Auto-start on boot, restart on crash                                                                  |
| **Build**               | `tsc` (server) + `vite build` (client)                             | Standard TypeScript compilation                                                                       |

---

## 3. Architecture

### Remote Connection Model

The Node.js server on the Mac Mini serves **everything** — both the React frontend (static files) and the WebSocket terminal bridge. There is no cloud hosting. Tailscale provides the encrypted network layer.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         Tailscale Mesh VPN (encrypted)                       │
│                                                                              │
│  ┌─────────────────────────┐              ┌─────────────────────────────┐   │
│  │  Phone / Laptop         │              │  Mac Mini (terminal-bridge) │   │
│  │  Browser                │              │  Node.js server :3001       │   │
│  │                         │   Tailscale  │                             │   │
│  │  Opens:                 │◀────────────▶│  1. Serves React app (GET)  │   │
│  │  https://terminal-      │   tunnel     │  2. Accepts WSS connections │   │
│  │  bridge.tailnet:3001    │              │  3. Bridges WS ↔ PTY        │   │
│  │                         │              │                             │   │
│  └─────────────────────────┘              └─────────────────────────────┘   │
│                                                                              │
│  NOT exposed to the public internet. Only devices on your tailnet can reach. │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Connection sequence:**

1. You open `https://terminal-bridge.tailnet:3001` on your phone/laptop
2. Tailscale routes the request through its encrypted mesh to your Mac Mini
3. Express serves the React app (static HTML/JS/CSS from `client/dist/`)
4. The React app loads in your browser, shows the login screen
5. You enter your auth token, the app opens `wss://terminal-bridge.tailnet:3001/ws?token=<token>`
6. Server validates token, spawns/reattaches to the tmux session via PTY
7. Full bidirectional terminal I/O flows over the WebSocket

### System Diagram

```
┌─────────────────────────────┐
│  Browser (Phone / Laptop)   │
│  React 19 + xterm.js 5      │
│  ┌────────────────────────┐ │
│  │  Login Screen          │ │  ← token auth
│  │  Terminal Viewport     │ │  ← xterm.js renders ANSI output
│  │  Mobile Key Bar        │ │  ← ESC, TAB, Ctrl+C buttons
│  │  Auto-reconnect        │ │  ← reconnects on drop, reattaches tmux
│  └────────────────────────┘ │
└──────────────┬──────────────┘
               │ WebSocket (wss://terminal-bridge.tailnet:3001/ws)
               │ Binary frames with command prefix byte
               │ ↓ 0x00 + keystrokes
               │ ↑ 0x00 + terminal output (ANSI)
               │ ↓ 0x01 + resize JSON
               │ ↑ 0x01 + window title
               │ ↕ 0x02 + pause/resume (flow control)
┌──────────────┴──────────────┐
│  Node.js Server (Mac Mini)  │
│  Express + ws + node-pty    │
│  ┌────────────────────────┐ │
│  │  Static file server    │ │  ← serves built React app
│  │  WebSocket handler     │ │  ← auth, binary protocol, PTY bridge
│  │  Health endpoint       │ │  ← /api/health
│  └────────────────────────┘ │
└──────────────┬──────────────┘
               │ PTY (forkpty)
               │ bidirectional terminal I/O
┌──────────────┴──────────────┐
│  tmux session "claude-web"  │
│  ┌────────────────────────┐ │
│  │  Claude Code TUI       │ │  ← full interactive mode
│  │  (or any shell/codex)  │ │  ← isatty() → true
│  └────────────────────────┘ │
└─────────────────────────────┘
```

### Binary WebSocket Protocol

Borrowed from ttyd's proven design. All WebSocket messages use **binary frames**. The first byte is a command identifier — no ambiguous "try JSON.parse, fall back to raw" logic.

**Client → Server:**

| Byte | Command | Payload                                    |
| ---- | ------- | ------------------------------------------ |
| `0`  | INPUT   | Raw terminal input bytes (keystrokes)      |
| `1`  | RESIZE  | JSON: `{"cols": N, "rows": N}`             |
| `2`  | PAUSE   | (none) — flow control: stop sending output |
| `3`  | RESUME  | (none) — flow control: resume output       |

**Server → Client:**

| Byte | Command | Payload                                     |
| ---- | ------- | ------------------------------------------- |
| `0`  | OUTPUT  | Raw terminal output (ANSI escape sequences) |
| `1`  | TITLE   | String: window/session title                |
| `2`  | ALERT   | String: server-side notification            |

This is cleaner, faster, and extensible. Adding new message types later (e.g., file transfer, session list) just means reserving a new byte.

### Data Flow

1. **User presses a key** → xterm.js `onData` fires → `[0x00, ...bytes]` sent as binary WebSocket frame
2. **Server receives frame** → reads byte 0 → dispatches: `0x00` writes payload to PTY master → appears on PTY slave stdin → Claude Code reads it
3. **Claude Code outputs** → writes to PTY slave stdout (ANSI sequences) → PTY master `onData` fires → `[0x00, ...bytes]` sent over WebSocket
4. **Browser receives frame** → reads byte 0 → dispatches: `0x00` calls `term.write()` → xterm.js renders the TUI

### Resize Flow

1. Browser window resizes → `fitAddon.fit()` recalculates cols/rows
2. `[0x01, ...JSON]` sent over WebSocket
3. Server reads byte 0, dispatches `0x01` → parses JSON → calls `shell.resize(cols, rows)` → sends `SIGWINCH` to PTY
4. Claude Code catches signal, queries new terminal size, redraws its TUI

### Auto-Reconnect

When the WebSocket drops (phone locks, Wi-Fi switches, Tailscale reconnects):

1. Client detects `ws.onclose` event
2. Shows a "Reconnecting..." overlay on the terminal (not a full page switch)
3. Retries connection with exponential backoff: 1s → 2s → 4s → 8s → max 30s
4. On successful reconnect, sends auth token + current terminal dimensions
5. Server reattaches to the existing tmux session — the user picks up exactly where they left off
6. Overlay disappears, terminal is interactive again

This is critical for mobile use. Your phone **will** lock, connections **will** drop. Without auto-reconnect you'd be constantly re-entering your token.

---

## 4. Project Structure

```
terminal-bridge/
├── docs/
│   ├── claude-code-web-terminal.md    # Original spec
│   └── IMPLEMENTATION_PLAN.md         # This file
├── shared/
│   └── protocol.ts                    # Binary protocol constants (shared between client & server)
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       └── server.ts                  # Express + WebSocket + PTY bridge
├── client/
│   ├── package.json
│   ├── tsconfig.json
│   ├── tsconfig.app.json
│   ├── tsconfig.node.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── main.tsx                   # React entry point
│       ├── App.tsx                    # Login screen + terminal view routing
│       ├── Terminal.tsx               # xterm.js component, WS bridge, auto-reconnect
│       ├── KeyBar.tsx                 # Mobile special keys (ESC, TAB, Ctrl+C, etc.)
│       └── styles.css                 # Dark terminal theme
├── .prettierrc                        # Shared Prettier config (root level)
├── eslint.config.js                   # Shared ESLint config (root level)
├── .editorconfig                      # Editor consistency
└── README.md                          # Setup & usage instructions
```

**Notes:**

- Monorepo with separate `server/` and `client/` packages. Shared ESLint + Prettier config at the root.
- `shared/protocol.ts` defines the binary command bytes and is imported by both client and server — single source of truth for the protocol.

---

## 5. Code Formatting & Linting Configuration

Taken directly from the jewel-thief-safehouse project to ensure consistency:

### `.prettierrc`

```json
{
    "semi": true,
    "singleQuote": true,
    "trailingComma": "all",
    "printWidth": 140,
    "tabWidth": 4,
    "bracketSpacing": true,
    "arrowParens": "always"
}
```

### `eslint.config.js`

```javascript
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
    globalIgnores(['dist', 'server/dist', 'client/dist']),
    {
        files: ['**/*.{ts,tsx}'],
        extends: [js.configs.recommended, tseslint.configs.recommended, reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
        languageOptions: {
            ecmaVersion: 2020,
            globals: { ...globals.browser, ...globals.node },
        },
        rules: {
            curly: ['error', 'all'],
            'brace-style': ['error', '1tbs', { allowSingleLine: false }],
            'nonblock-statement-body-position': ['error', 'below'],
        },
    },
]);
```

### Scripts (root `package.json`)

```json
{
    "scripts": {
        "format": "prettier --write . && eslint . --fix",
        "lint": "eslint ."
    }
}
```

---

## 6. Implementation Phases

### Phase 1 — Project Scaffolding

1. Initialise root `package.json` with workspace scripts (`format`, `lint`)
2. Create `.prettierrc`, `eslint.config.js`, `.editorconfig` at root
3. Create `shared/protocol.ts` — binary protocol constants shared by client and server
4. Create `server/` directory with `package.json`, `tsconfig.json`
5. Create `client/` directory with `package.json`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `vite.config.ts`, `index.html`
6. Install all dependencies

### Phase 2 — Server Implementation

1. Write `server/src/server.ts`:
    - Express app serving static files from `client/dist`
    - Health check endpoint at `/api/health`
    - SPA fallback route
    - WebSocket server on `/ws` path with token authentication
    - PTY spawn (tmux wrapping Claude Code) with `node-pty`
    - **Binary protocol**: read first byte of each incoming frame to dispatch:
        - `0x00` INPUT → write payload to PTY
        - `0x01` RESIZE → parse JSON payload, call `shell.resize()`
        - `0x02` PAUSE → pause PTY output buffering
        - `0x03` RESUME → resume PTY output
    - PTY output → prepend `0x00` byte → send as binary WebSocket frame
    - Cleanup on disconnect (don't kill tmux — session persists)
    - Cleanup on PTY exit (close WebSocket)
2. Configure via environment variables:
    - `TERMINAL_BRIDGE_AUTH_TOKEN` — shared secret for WebSocket auth
    - `PORT` — default `3001`
    - `ANTHROPIC_API_KEY` — passed through to PTY environment

### Phase 3 — Client Implementation

1. Write `client/src/main.tsx` — React entry point
2. Write `client/src/styles.css` — dark terminal theme (GitHub Dark inspired)
3. Write `client/src/App.tsx`:
    - Connection state machine: `disconnected` → `connecting` → `connected` → `reconnecting` → `error`
    - Login screen with token input
    - Terminal view with header (status dot, title, disconnect button)
4. Write `client/src/Terminal.tsx`:
    - Create xterm.js instance with theme configuration
    - Load addons: FitAddon, WebLinksAddon, WebglAddon (with canvas fallback)
    - Open WebSocket to `wss://terminal-bridge.tailnet:3001/ws?token=<token>`
    - **Binary protocol**: all sends/receives use the shared protocol constants
    - Bridge: incoming `0x00` frame → `term.write(payload)` (server output to screen)
    - Bridge: `term.onData` → `[0x00, ...bytes]` sent as binary frame (keystrokes to server)
    - Resize handler: `fitAddon.fit()` → `[0x01, ...JSON]` sent as binary frame
    - **Auto-reconnect**: on `ws.onclose`:
        - Show "Reconnecting..." overlay on terminal (not a page change)
        - Exponential backoff: 1s → 2s → 4s → 8s → max 30s
        - On reconnect, re-send auth token + terminal dimensions
        - tmux reattaches automatically — user resumes where they left off
        - Overlay disappears on successful reconnect
    - Cleanup on unmount

### Phase 4 — Mobile Enhancements

1. Write `client/src/KeyBar.tsx` — on-screen special key toolbar:
    - ESC, TAB, Ctrl+C, Ctrl+D, Arrow keys (↑↓←→)
    - Each button sends the appropriate escape sequence via the binary protocol
    - Positioned above the terminal, below the header
2. Viewport meta tag: `user-scalable=no` to prevent zoom interference
3. Orientation change listener with delayed resize

### Phase 5 — Build & Verification

1. Build client: `cd client && npm run build`
2. Build server: `cd server && npm run build`
3. Run `npm run format` and `npm run lint` from root — ensure zero errors
4. Test locally: start server, open browser, verify login + terminal rendering
5. Verify auto-reconnect: connect, kill the WebSocket, confirm overlay + automatic reattach

### Phase 6 — Deployment Configuration

1. Document Tailscale setup:
    - Install Tailscale on Mac Mini
    - Set machine name to `terminal-bridge` → accessible at `https://terminal-bridge.tailnet:3001`
    - Install Tailscale on phone/laptop, same tailnet
2. Document HTTPS with Tailscale cert provisioning:
    - `tailscale cert terminal-bridge.tailnet.ts.net`
    - Server reads cert/key files for HTTPS
3. Create macOS LaunchAgent plist for persistent service (auto-start, auto-restart)
4. Document environment variable setup (`ANTHROPIC_API_KEY`, `TERMINAL_BRIDGE_AUTH_TOKEN`)

---

## 7. Key Dependencies

### Server (`server/package.json`)

| Package          | Version | Purpose                    |
| ---------------- | ------- | -------------------------- |
| `express`        | ^4.18   | HTTP server + static files |
| `ws`             | ^8.16   | WebSocket server           |
| `node-pty`       | ^1.0    | PTY allocation (forkpty)   |
| `cors`           | ^2.8    | Cross-origin support       |
| `@types/express` | ^4.17   | TypeScript types           |
| `@types/ws`      | ^8.5    | TypeScript types           |
| `@types/cors`    | ^2.8    | TypeScript types           |
| `typescript`     | ~5.9    | TypeScript compiler        |

### Client (`client/package.json`)

| Package                  | Version | Purpose                           |
| ------------------------ | ------- | --------------------------------- |
| `react`                  | ^19.2   | UI framework                      |
| `react-dom`              | ^19.2   | DOM renderer                      |
| `@xterm/xterm`           | ^5.5    | Terminal emulator                 |
| `@xterm/addon-fit`       | ^0.10   | Auto-resize terminal to container |
| `@xterm/addon-web-links` | ^0.11   | Clickable URLs in terminal        |
| `@xterm/addon-webgl`     | ^0.18   | GPU-accelerated rendering         |
| `@vitejs/plugin-react`   | ^5.1    | Vite React plugin                 |
| `typescript`             | ~5.9    | TypeScript compiler               |
| `vite`                   | ^7.3    | Build tool + dev server           |

### Root (dev dependencies for linting/formatting)

| Package                       | Version | Purpose                                           |
| ----------------------------- | ------- | ------------------------------------------------- |
| `@eslint/js`                  | ^9.39   | ESLint base config                                |
| `eslint`                      | ^9.39   | Linter                                            |
| `eslint-config-prettier`      | ^10.1   | Disables ESLint rules that conflict with Prettier |
| `eslint-plugin-prettier`      | ^5.5    | Runs Prettier as an ESLint rule                   |
| `eslint-plugin-react-hooks`   | ^7.0    | React hooks linting                               |
| `eslint-plugin-react-refresh` | ^0.4    | React Fast Refresh safety                         |
| `globals`                     | ^16.5   | Global variable definitions                       |
| `prettier`                    | ^3.8    | Code formatter                                    |
| `typescript-eslint`           | ^8.48   | TypeScript ESLint integration                     |

---

## 8. Security Model

1. **Network isolation** — Tailscale mesh VPN only. Port 3001 is never exposed to the public internet.
2. **Token authentication** — WebSocket connections require a shared secret passed as `?token=` query parameter. Rejected immediately on mismatch.
3. **TLS** — Tailscale cert provisioning for HTTPS/WSS. No plaintext over the wire.
4. **Environment variables** — API keys and auth tokens stored in env vars, never in code.
5. **tmux session isolation** — Named session `claude-web` to prevent session collision.

---

## 9. How tmux Persistence Works

Without tmux: WebSocket drops → PTY dies → Claude Code killed → all in-progress work lost.

With tmux:

- Server spawns `tmux new-session -A -s claude-web` in the PTY
- `-A` means "attach if exists, create if not"
- WebSocket drops → PTY dies, but tmux server keeps running in the background
- Next connection → new PTY spawns → `tmux new-session -A -s claude-web` **reattaches** to the existing session
- Claude Code never noticed anything happened

Additional benefits:

- `Ctrl+B C` — new tmux window (shell for git, tests, etc.)
- `Ctrl+B N` — switch between windows
- Multiple browser tabs can attach to the same session simultaneously

---

## 10. Decisions Made

| Decision           | Choice                                                     | Reasoning                                                     |
| ------------------ | ---------------------------------------------------------- | ------------------------------------------------------------- |
| React version      | 19                                                         | Matches jewel-thief-safehouse, latest stable                  |
| Styling            | Plain CSS                                                  | Minimal UI (login + fullscreen terminal), no framework needed |
| WebSocket protocol | Binary with command prefix                                 | Cleaner than JSON.parse fallback, extensible, proven by ttyd  |
| Auto-reconnect     | Yes, with exponential backoff                              | Critical for mobile — phone locks, Wi-Fi switches             |
| Mobile key bar     | Included in v1                                             | Small effort, big impact on phone usability                   |
| Port               | 3001 (configurable via env)                                | Standard for this kind of service                             |
| Tailscale hostname | `terminal-bridge` → `https://terminal-bridge.tailnet:3001` | User-specified                                                |
| Client hosting     | Self-served by the Node.js server                          | No cloud needed, one process does everything                  |

## 11. Remaining Open Decisions

1. **Monorepo structure** — Two separate packages (`server/`, `client/`) with shared root linting config. Alternative: single package with both. Current plan keeps them separate for cleaner build concerns. Confirm?

2. **Session management** — Current plan: single named tmux session `claude-web` shared across all connections. Multiple browser tabs see the same terminal (useful for monitoring). Alternative: per-connection sessions with unique names for isolation.

3. **Auto-launch Claude Code** — Current plan: user types `claude` in tmux manually. Alternative: auto-launch via `.tmux.conf` or by spawning `claude` directly. Manual gives more flexibility (can run shell commands, switch repos, etc.).

4. **LaunchAgent plist** — Generate as part of the project or just document it? Since paths and tokens are machine-specific, documentation seems more appropriate.

5. **Future growth path** — claudecodeui shows what's possible: file explorer, git UI, tool approval dialogs, multi-provider support. Any of these on your radar for v2, or keep it purely terminal-based?

---

## 12. What This Plan Does NOT Include (But Could Later)

These are deliberately excluded from v1 to keep things simple and shippable. All are viable v2+ additions:

- **User management / multi-user auth** — This is a single-user tool for your personal Mac Mini. Token auth is sufficient. _Later: JWT + bcrypt like claudecodeui if you want multi-user._
- **Database** — No state to persist. tmux handles session persistence. _Later: SQLite for session history, user prefs._
- **File explorer / code editor** — v1 is purely terminal. _Later: file tree + CodeMirror like claudecodeui._
- **Git UI** — Use git from within the terminal. _Later: status/diff/commit UI panel._
- **Tool approval UI** — Claude Code's permission prompts work fine in the terminal. _Later: structured dialog like claudecodeui._
- **Multi-provider support** — v1 is Claude Code focused. _Later: Codex, Gemini CLI via the same PTY bridge._
- **Docker** — Running natively on macOS for direct PTY access and Claude Code performance.
- **CI/CD** — Manual deploy via git pull + rebuild. Can be added later.
- **Testing** — Small surface area. Manual testing against a real Claude Code session is more valuable than unit tests for v1.
