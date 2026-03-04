# CLAUDE.md — Terminal Bridge

## What is this project?

Terminal Bridge is a monorepo that exposes a host machine's terminal and AI chat over the web. It has two browser clients — a full xterm.js terminal and a ChatGPT-style AI chat UI — both served by a single Express + WebSocket server.

## Repository Structure

```
terminal-bridge/
├── client/           # xterm.js terminal client (React + Vite)
├── client-ai/        # AI chat client (React + Vite)
│   ├── src/
│   │   ├── components/    # React components
│   │   ├── hooks/         # Custom hooks (use-ai-socket)
│   │   ├── state/         # Chat state reducer + context
│   │   ├── themes.ts      # Theme definitions + applyTheme()
│   │   ├── thinking-keywords.ts  # Animated thinking phrases
│   │   └── styles.css     # All CSS (uses CSS custom properties)
│   └── .env          # Auth token (gitignored)
├── server/           # Express + WebSocket server
│   └── src/
│       ├── server.ts              # Composition root (TerminalBridgeServer)
│       ├── terminal-handler.ts    # Terminal WebSocket ↔ PTY bridge
│       ├── ai-handler.ts         # AI WebSocket ↔ Provider bridge
│       └── providers/
│           ├── agent-provider.ts  # Abstract base (Strategy pattern)
│           ├── claude-provider.ts # Claude Agent SDK implementation
│           └── provider-registry.ts # Provider registry (OCP)
├── shared/           # Shared protocol types
│   ├── protocol.ts      # Binary terminal protocol (ClientCmd/ServerCmd)
│   └── ai-protocol.ts   # JSON AI protocol (AiClientMessage/AiServerMessage)
├── docs/             # Design docs
├── eslint.config.js  # ESLint flat config
├── .prettierrc       # Prettier config
└── package.json      # Root workspace scripts
```

## Architecture

### Two WebSocket Servers on One HTTP Server

The server uses `noServer` mode for both WebSocket servers and a single `upgrade` handler that routes by pathname:

- `/ws` — Terminal (binary frames, `shared/protocol.ts`)
- `/ws-ai` — AI chat (JSON text frames, `shared/ai-protocol.ts`)

### Terminal Flow

`Browser (xterm.js) ↔ WebSocket (binary) ↔ TerminalConnectionHandler ↔ node-pty ↔ tmux session`

- PTY spawns `tmux new-session -A -s claude-web`
- Supports resize, flow control (pause/resume), reconnection

### AI Chat Flow

`Browser (React) ↔ WebSocket (JSON) ↔ AiConnectionHandler ↔ AgentProvider (async generator) ↔ Claude Agent SDK`

- Provider yields `AiServerMessage` frames as they arrive (streaming)
- Supports text deltas, thinking deltas, tool use, permission requests, interrupts
- Model switching at runtime

### SOLID Principles in Server

- **SRP**: Each handler class owns one connection type
- **OCP**: New providers extend `AgentProvider`, register in `ProviderRegistry`
- **LSP**: Any provider substitutes in handler/registry
- **ISP**: `AgentProvider` has thin abstract surface
- **DIP**: Handler depends on `AgentProvider` abstraction, not `ClaudeProvider`

## Key Patterns

### Path Aliases

All tsconfigs and Vite configs use `@shared/*` → `../shared/*`.

### Client-AI Routing

- Vite: `base: '/ai/'`
- Server: `app.use('/ai', express.static(clientAiDist))` + SPA fallback

### Theme System

- 4 themes defined in `client-ai/src/themes.ts` (Dark, Neon Heist, Neon Ice, Vanilla)
- CSS uses custom properties (`var(--bg)`, `var(--accent)`, etc.)
- `applyTheme()` sets vars on `document.documentElement.style`
- Persisted in localStorage under `terminal-bridge-theme`
- Restored on mount in `app.tsx`

### State Management

- `chat-state.ts` uses `useReducer` with a discriminated union (`ChatAction`)
- `ChatContext` provides state + dispatch to all components
- Server messages flow through `handleServerMessage()` reducer branch

### WebSocket Reconnection

Both clients use exponential backoff: 1s initial → 30s max, reset on successful connect.

### Callback Refs

Hooks sync callback refs inside `useEffect()` (not during render) to avoid stale closures in WebSocket handlers.

## Build & Run

### Prerequisites

- Node.js 22+, npm
- macOS with tmux installed (`brew install tmux`)
- Claude Code installed and authenticated (`npm install -g @anthropic-ai/claude-code`)
- `TERMINAL_BRIDGE_AUTH_TOKEN` env var set (shared by server + client-ai `.env`)

### Commands

```bash
# Install all dependencies
npm install && cd client && npm install && cd ../client-ai && npm install && cd ../server && npm install && cd ..

# Build everything
npm run build

# Start server (production)
cd server && npm start

# Dev mode (separate terminals)
npm run dev:server      # Server with tsx hot-reload
npm run dev:client      # Terminal client on :5173
npm run dev:client-ai   # AI client on :5174

# Lint + format
npm run format
npm run lint
```

### Environment Variables

| Variable | Used By | Purpose |
|----------|---------|---------|
| `TERMINAL_BRIDGE_AUTH_TOKEN` | Server + client-ai `.env` | WebSocket auth token |
| `PORT` | Server | HTTP port (default 3001) |

## Code Conventions

- **ESLint**: Flat config, `curly: all`, `brace-style: 1tbs`
- **TypeScript**: `strict: true`, ESM throughout, `~5.9`
- **React**: 19, functional components only, `React.FC` typing
- **Vite**: 7, with `@vitejs/plugin-react`
- **CSS**: No CSS-in-JS; single `styles.css` per client using CSS custom properties
- **No emojis** in code unless user requests
- **Imports**: Named imports from `@shared/*`, relative for local

## Key File Quick Reference

| What | File |
|------|------|
| Server entry | `server/src/server.ts` |
| Terminal handler | `server/src/terminal-handler.ts` |
| AI handler | `server/src/ai-handler.ts` |
| Provider base class | `server/src/providers/agent-provider.ts` |
| Claude provider | `server/src/providers/claude-provider.ts` |
| Provider registry | `server/src/providers/provider-registry.ts` |
| Terminal protocol | `shared/protocol.ts` |
| AI protocol | `shared/ai-protocol.ts` |
| AI chat layout | `client-ai/src/components/ai-chat-layout.tsx` |
| Chat state reducer | `client-ai/src/state/chat-state.ts` |
| AI WebSocket hook | `client-ai/src/hooks/use-ai-socket.ts` |
| Theme definitions | `client-ai/src/themes.ts` |
| Settings panel | `client-ai/src/components/settings-panel.tsx` |
| Thinking animation | `client-ai/src/components/thinking-animation.tsx` |
| Thinking keywords | `client-ai/src/thinking-keywords.ts` |
| All AI styles | `client-ai/src/styles.css` |
| Terminal component | `client/src/terminal.tsx` |
| Terminal styles | `client/src/styles.css` |

## Adding a New AI Provider

1. Create `server/src/providers/my-provider.ts` extending `AgentProvider`
2. Implement all abstract methods (see `claude-provider.ts` for reference)
3. Register in `server.ts`: `this.registry.register(new MyProvider())`
4. No other changes needed — the handler and protocol are provider-agnostic

## Common Gotchas

- **React 19**: `useRef()` requires an initial value argument (e.g., `useRef<T>(null)` or `useRef<T>(undefined)`)
- **Server output path**: Compiled JS is at `dist/server/src/server.js` (not `dist/server.js`) due to `rootDir: ".."` in tsconfig
- **CSS `background-clip: text` + `transform`**: Never combine on the same element — use a wrapper for transforms
- **WebSocket auth**: Token is passed as `?token=` query param on the WS URL
- **`.env` is client-ai only**: The server reads `TERMINAL_BRIDGE_AUTH_TOKEN` from the shell environment, not from a `.env` file
