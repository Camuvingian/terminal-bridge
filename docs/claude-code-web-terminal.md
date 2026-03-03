# Claude Code Web Terminal

A web-based React/TypeScript application that provides browser access to Claude Code running natively on a remote Mac Mini via SSH. The browser renders a full terminal emulator that proxies into the machine's command line, where Claude Code runs as a native TUI application.

---

## Architecture Overview

```
┌─────────────────────┐
│  Phone / Browser     │
│  React + xterm.js    │
│  (renders terminal)  │
└──────────┬──────────┘
           │ WebSocket (wss://)
           │ raw terminal data
┌──────────┴──────────┐
│  Node.js Server      │
│  Express + ws        │
│  (Mac Mini)          │
└──────────┬──────────┘
           │ PTY (forkpty)
           │ full terminal emulation
┌──────────┴──────────┐
│  Claude Code TUI     │
│  runs natively       │
│  thinks it's a real  │
│  terminal            │
└─────────────────────┘
```

The key insight: Claude Code is a TUI (Text User Interface) application. It doesn't read stdin/stdout like a simple CLI tool — it takes over the terminal with cursor positioning, escape sequences, colour rendering, and interactive prompts. A pseudo-terminal (PTY) makes Claude Code believe it's running in a real terminal. The PTY output (ANSI escape sequences) flows over a WebSocket to xterm.js in the browser, which renders the full Claude Code interface. Keystrokes travel the reverse path.

---

## Prerequisites

### On the Mac Mini

- **Node.js 18+** — `brew install node`
- **Claude Code** — `npm install -g @anthropic-ai/claude-code`
- **Anthropic API key** — set in your shell profile (`export ANTHROPIC_API_KEY=sk-ant-...`)
- **Tailscale** — for secure remote access without port forwarding (`brew install tailscale`)
- **tmux** (optional) — `brew install tmux` for persistent sessions

### On your phone/laptop

- A modern browser (Safari, Chrome)
- Tailscale installed and connected to the same tailnet

---

## Server Side — Yes, You Need One

You need a small Node.js server running on the Mac Mini. It does three things:

1. Serves the React frontend (static files)
2. Accepts WebSocket connections from the browser
3. Spawns Claude Code inside a PTY and bridges the WebSocket to it

This is roughly 80 lines of code.

---

## Project Structure

```
claude-web-terminal/
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       └── server.ts          # Express + WebSocket + PTY bridge
├── client/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── src/
│       ├── App.tsx            # Main React component
│       ├── main.tsx           # Entry point
│       ├── Terminal.tsx        # xterm.js terminal component
│       └── styles.css         # Terminal styling
└── README.md
```

---

## Step 1: Server Implementation

### `server/package.json`

```json
{
  "name": "claude-web-terminal-server",
  "version": "1.0.0",
  "scripts": {
    "build": "tsc",
    "start": "node dist/server.js",
    "dev": "ts-node src/server.ts"
  },
  "dependencies": {
    "express": "^4.18.2",
    "ws": "^8.16.0",
    "node-pty": "^1.0.0",
    "cors": "^2.8.5"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/ws": "^8.5.10",
    "@types/cors": "^2.8.17",
    "typescript": "^5.3.0",
    "ts-node": "^10.9.2"
  }
}
```

### `server/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true
  }
}
```

### `server/src/server.ts`

This is the core of the entire system. Every line matters, so here it is annotated:

```typescript
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import * as pty from 'node-pty';
import path from 'path';
import cors from 'cors';

const app = express();
const PORT = parseInt(process.env.PORT || '3001');

// A simple shared secret. Replace with something real in production.
// The browser sends this as a query param on the WebSocket URL.
const AUTH_TOKEN = process.env.TERMINAL_AUTH_TOKEN || 'change-me-immediately';

app.use(cors());

// Serve the built React frontend
app.use(express.static(path.join(__dirname, '../../client/dist')));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// SPA fallback — serve index.html for any non-API route
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../../client/dist/index.html'));
});

const server = createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws: WebSocket, req) => {
  // ------------------------------------
  // AUTH: Reject unauthenticated clients
  // ------------------------------------
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const token = url.searchParams.get('token');

  if (token !== AUTH_TOKEN) {
    ws.send('\r\n\x1b[31mAuthentication failed.\x1b[0m\r\n');
    ws.close();
    return;
  }

  console.log('[+] Client connected, spawning Claude Code...');

  // ------------------------------------
  // PTY: Spawn Claude Code in a real PTY
  // ------------------------------------
  // node-pty calls forkpty() on macOS, which allocates a proper
  // pseudo-terminal device pair. Claude Code's isatty() returns true,
  // so it launches its full TUI with colours, cursor movement, etc.
  //
  // We spawn tmux wrapping Claude Code so that:
  //   1. The session persists if the WebSocket drops
  //   2. You can attach multiple browser tabs to the same session
  //   3. You can detach and switch to a raw shell if needed
  const shell = pty.spawn('tmux', [
    'new-session', '-A', '-s', 'claude-web'
    // -A = attach if session exists, create if not
    // -s = session name
    // Claude Code is launched inside tmux manually or via .tmux.conf
    // This way you get both Claude Code AND shell access
  ], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: process.env.HOME || '/Users/nick',
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      // Ensure Claude Code picks up the API key
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
    }
  });

  // ------------------------------------
  // BRIDGE: PTY ↔ WebSocket
  // ------------------------------------

  // Claude Code TUI output → browser
  // This includes all ANSI escape sequences (colours, cursor moves,
  // screen clears, etc.) that xterm.js will interpret and render.
  shell.onData((data: string) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });

  // Browser keystrokes → Claude Code TUI input
  // When you press a key in xterm.js, it sends the raw character(s)
  // over the WebSocket. We write them into the PTY, and Claude Code
  // receives them exactly as if you pressed them on a physical keyboard.
  ws.on('message', (msg: Buffer | string) => {
    const data = msg.toString();

    // Check if it's a control message (JSON) for resize events
    try {
      const parsed = JSON.parse(data);
      if (parsed.type === 'resize' && parsed.cols && parsed.rows) {
        shell.resize(parsed.cols, parsed.rows);
        return;
      }
    } catch {
      // Not JSON — it's raw terminal input, pass it through
    }

    shell.write(data);
  });

  // Cleanup when the browser disconnects
  ws.on('close', () => {
    console.log('[-] Client disconnected');
    // Don't kill the PTY — tmux keeps the session alive.
    // Next connection will reattach to the same session.
    // If you want to kill on disconnect, uncomment:
    // shell.kill();
  });

  // Cleanup if the PTY process dies
  shell.onExit(({ exitCode }) => {
    console.log(`[!] PTY exited with code ${exitCode}`);
    ws.close();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Claude Web Terminal running on http://0.0.0.0:${PORT}`);
  console.log(`Auth token: ${AUTH_TOKEN}`);
});
```

### Why tmux instead of spawning `claude` directly

If you spawn `claude` directly and the WebSocket drops (phone locks, connection hiccup), the PTY dies and you lose your entire Claude Code session — including any in-progress work. Wrapping in tmux means:

- The session survives disconnects. Reconnect and you're back where you left off.
- You can open multiple tmux windows: one running Claude Code, another with a regular shell for git, running tests, etc.
- Multiple browser tabs can attach to the same session simultaneously.

When you first connect, you'll land in a tmux shell. Type `claude` to start Claude Code. Use `Ctrl+B C` to open a new tmux window, `Ctrl+B N` to switch between them.

If you want Claude Code to auto-launch, create `~/.tmux.conf` with:

```
new-session -s claude-web 'claude'
```

Or spawn it directly without tmux if you don't care about session persistence:

```typescript
const shell = pty.spawn('claude', [], {
  name: 'xterm-256color',
  cols: 80,
  rows: 24,
  cwd: process.env.HOME || '/Users/nick',
  env: { ...process.env, TERM: 'xterm-256color' }
});
```

---

## Step 2: Client Implementation

### `client/package.json`

```json
{
  "name": "claude-web-terminal-client",
  "version": "1.0.0",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "@xterm/xterm": "^5.5.0",
    "@xterm/addon-fit": "^0.10.0",
    "@xterm/addon-web-links": "^0.11.0",
    "@xterm/addon-webgl": "^0.18.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@vitejs/plugin-react": "^4.2.0",
    "typescript": "^5.3.0",
    "vite": "^5.0.0"
  }
}
```

### `client/vite.config.ts`

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    }
  }
});
```

### `client/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "outDir": "./dist"
  },
  "include": ["src"]
}
```

### `client/src/main.tsx`

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

### `client/src/App.tsx`

```tsx
import React, { useState } from 'react';
import Terminal from './Terminal';

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

const App: React.FC = () => {
  const [state, setState] = useState<ConnectionState>('disconnected');
  const [token, setToken] = useState<string>('');
  const [error, setError] = useState<string>('');

  const handleConnect = () => {
    if (!token.trim()) {
      setError('Enter auth token');
      return;
    }
    setError('');
    setState('connecting');
  };

  const handleDisconnect = () => {
    setState('disconnected');
  };

  const handleError = (msg: string) => {
    setError(msg);
    setState('error');
  };

  const handleConnected = () => {
    setState('connected');
  };

  // Login screen
  if (state === 'disconnected' || state === 'error') {
    return (
      <div className="login-container">
        <div className="login-card">
          <div className="login-header">
            <span className="login-icon">▸</span>
            <h1>Claude Terminal</h1>
          </div>
          <p className="login-subtitle">
            Web proxy into Claude Code on your Mac Mini
          </p>
          <input
            type="password"
            className="token-input"
            placeholder="Auth token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
            autoFocus
          />
          {error && <p className="error-text">{error}</p>}
          <button className="connect-btn" onClick={handleConnect}>
            Connect
          </button>
        </div>
      </div>
    );
  }

  // Terminal view
  return (
    <div className="terminal-container">
      <div className="terminal-header">
        <span className="terminal-title">
          <span className="status-dot" />
          Claude Code — Mac Mini
        </span>
        <button className="disconnect-btn" onClick={handleDisconnect}>
          ✕
        </button>
      </div>
      <Terminal
        token={token}
        onConnected={handleConnected}
        onError={handleError}
        onDisconnect={handleDisconnect}
      />
    </div>
  );
};

export default App;
```

### `client/src/Terminal.tsx`

This is the critical component. It creates the xterm.js instance, connects the WebSocket, and handles resize events.

```tsx
import React, { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';

interface TerminalProps {
  token: string;
  onConnected: () => void;
  onError: (msg: string) => void;
  onDisconnect: () => void;
}

const Terminal: React.FC<TerminalProps> = ({
  token,
  onConnected,
  onError,
  onDisconnect,
}) => {
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!termRef.current) return;

    // -----------------------------------------
    // 1. Create the xterm.js terminal instance
    // -----------------------------------------
    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 14,
      fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", monospace',
      theme: {
        background: '#0d1117',
        foreground: '#e6edf3',
        cursor: '#58a6ff',
        selectionBackground: '#264f78',
        black: '#484f58',
        red: '#ff7b72',
        green: '#7ee787',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#76e3ea',
        white: '#e6edf3',
      },
      allowProposedApi: true,
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(termRef.current);

    // Try WebGL renderer for performance (falls back to canvas)
    try {
      term.loadAddon(new WebglAddon());
    } catch {
      console.log('WebGL not available, using canvas renderer');
    }

    fitAddon.fit();
    xtermRef.current = term;
    fitRef.current = fitAddon;

    // -----------------------------------------
    // 2. Open WebSocket to the server
    // -----------------------------------------
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${protocol}://${window.location.host}?token=${encodeURIComponent(token)}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      onConnected();
      term.focus();

      // Send initial terminal size so the PTY matches
      const dims = fitAddon.proposeDimensions();
      if (dims) {
        ws.send(JSON.stringify({
          type: 'resize',
          cols: dims.cols,
          rows: dims.rows,
        }));
      }
    };

    // Server → browser: PTY output (ANSI escape sequences)
    // xterm.js interprets these and renders the Claude Code TUI
    ws.onmessage = (event) => {
      term.write(event.data);
    };

    ws.onerror = () => {
      onError('WebSocket connection failed');
    };

    ws.onclose = () => {
      term.write('\r\n\x1b[33m[Connection closed]\x1b[0m\r\n');
    };

    // -----------------------------------------
    // 3. Browser → server: keystrokes
    // -----------------------------------------
    // Every key you press gets sent as raw terminal data.
    // Claude Code receives it exactly as physical keyboard input.
    term.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // -----------------------------------------
    // 4. Handle terminal resize
    // -----------------------------------------
    // When the browser window resizes, we need to:
    //   a) Resize xterm.js to fill the container
    //   b) Tell the server to resize the PTY
    //   c) Claude Code redraws its TUI to fit
    const handleResize = () => {
      fitAddon.fit();
      const dims = fitAddon.proposeDimensions();
      if (dims && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'resize',
          cols: dims.cols,
          rows: dims.rows,
        }));
      }
    };

    window.addEventListener('resize', handleResize);

    // Also handle orientation changes on mobile
    window.addEventListener('orientationchange', () => {
      setTimeout(handleResize, 200);
    });

    // -----------------------------------------
    // 5. Cleanup
    // -----------------------------------------
    return () => {
      window.removeEventListener('resize', handleResize);
      ws.close();
      term.dispose();
    };
  }, [token]);

  return <div ref={termRef} className="terminal-viewport" />;
};

export default Terminal;
```

### `client/src/styles.css`

```css
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&display=swap');

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body, #root {
  height: 100%;
  width: 100%;
  overflow: hidden;
  background: #0d1117;
  color: #e6edf3;
  font-family: 'JetBrains Mono', monospace;
}

/* ----- Login Screen ----- */

.login-container {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.login-card {
  width: 100%;
  max-width: 360px;
}

.login-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}

.login-icon {
  color: #58a6ff;
  font-size: 24px;
}

.login-header h1 {
  font-size: 20px;
  font-weight: 600;
  color: #e6edf3;
}

.login-subtitle {
  font-size: 13px;
  color: #8b949e;
  margin-bottom: 24px;
}

.token-input {
  width: 100%;
  padding: 10px 12px;
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 6px;
  color: #e6edf3;
  font-family: 'JetBrains Mono', monospace;
  font-size: 14px;
  outline: none;
  margin-bottom: 8px;
}

.token-input:focus {
  border-color: #58a6ff;
}

.error-text {
  color: #ff7b72;
  font-size: 12px;
  margin-bottom: 8px;
}

.connect-btn {
  width: 100%;
  padding: 10px;
  background: #238636;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  margin-top: 8px;
}

.connect-btn:hover {
  background: #2ea043;
}

/* ----- Terminal View ----- */

.terminal-container {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.terminal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: #161b22;
  border-bottom: 1px solid #30363d;
  flex-shrink: 0;
}

.terminal-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #8b949e;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #3fb950;
  display: inline-block;
}

.disconnect-btn {
  background: none;
  border: none;
  color: #8b949e;
  font-size: 16px;
  cursor: pointer;
  padding: 2px 6px;
}

.disconnect-btn:hover {
  color: #ff7b72;
}

.terminal-viewport {
  flex: 1;
  padding: 4px;
  overflow: hidden;
}

/* Ensure xterm fills its container */
.terminal-viewport .xterm {
  height: 100%;
}
```

### `client/index.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>Claude Terminal</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

---

## Step 3: Build and Run

### Initial setup (one time)

```bash
# Clone or create the project directory
mkdir -p ~/claude-web-terminal/{server,client}
cd ~/claude-web-terminal

# Install server dependencies
cd server
npm install

# Install client dependencies
cd ../client
npm install
```

### Build the client

```bash
cd ~/claude-web-terminal/client
npm run build
# Output goes to client/dist/
```

### Set environment variables

Add these to your `~/.zshrc` or `~/.bash_profile`:

```bash
export ANTHROPIC_API_KEY="sk-ant-api03-..."
export TERMINAL_AUTH_TOKEN="your-secret-token-here"
```

### Start the server

```bash
cd ~/claude-web-terminal/server
npm run dev
# Or for production:
npm run build && npm start
```

### Access it

Open your browser to `http://<mac-mini-ip>:3001`, enter your auth token, and you're in. Type `claude` in the tmux session to launch Claude Code.

---

## Step 4: Remote Access with Tailscale

Tailscale creates a private mesh VPN so you can access the Mac Mini from anywhere without port forwarding or exposing anything to the public internet.

### Install

```bash
# Mac Mini
brew install tailscale

# Phone
# Install Tailscale from App Store
```

### Connect both devices

Sign in on both devices with the same account. They'll see each other on a private network. Your Mac Mini gets a stable IP like `100.x.y.z` and a hostname like `mac-mini.tailnet-name.ts.net`.

### Access the terminal from anywhere

```
https://mac-mini.tailnet-name.ts.net:3001
```

### HTTPS with Tailscale (optional but recommended)

Tailscale can provision TLS certificates for your machine:

```bash
tailscale cert mac-mini.tailnet-name.ts.net
```

Then update `server.ts` to use HTTPS:

```typescript
import { readFileSync } from 'fs';
import { createServer } from 'https';

const server = createServer({
  cert: readFileSync('/path/to/mac-mini.tailnet-name.ts.net.crt'),
  key: readFileSync('/path/to/mac-mini.tailnet-name.ts.net.key'),
}, app);
```

---

## Step 5: Run as a Persistent Service

You want this to start automatically and survive reboots.

### macOS LaunchAgent

Create `~/Library/LaunchAgents/com.claude.webterminal.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.claude.webterminal</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/node</string>
    <string>/Users/nick/claude-web-terminal/server/dist/server.js</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>ANTHROPIC_API_KEY</key>
    <string>sk-ant-api03-...</string>
    <key>TERMINAL_AUTH_TOKEN</key>
    <string>your-secret-token</string>
    <key>PORT</key>
    <string>3001</string>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/claude-webterminal.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/claude-webterminal.err</string>
</dict>
</plist>
```

Load it:

```bash
# Build the server first
cd ~/claude-web-terminal/server && npm run build

# Load the service
launchctl load ~/Library/LaunchAgents/com.claude.webterminal.plist

# Check it's running
launchctl list | grep claude
```

---

## How the PTY Bridge Actually Works

This is the part that makes it all possible, so it's worth understanding properly.

### The problem

Claude Code is not a simple stdin/stdout program. If you try:

```javascript
const proc = child_process.spawn('claude');
proc.stdin.write('hello\n');
```

This fails. `spawn()` without a PTY doesn't allocate a TTY, so `isatty()` returns false, and Claude Code either refuses to start its TUI or falls back to a degraded mode. You can't interact with it properly because there's no terminal emulation — no cursor positioning, no escape sequence handling, no screen dimensions.

### The solution: PTY

`node-pty` calls `forkpty()` on macOS, which does two things:

1. Creates a pseudo-terminal device pair (`/dev/ptmx` master + `/dev/pts/N` slave)
2. Forks a child process with the slave end as its controlling terminal

Claude Code is the child process. It calls `isatty()`, gets `true`, checks `$TERM` (set to `xterm-256color`), and launches its full TUI. It sends ANSI escape sequences to its stdout (the PTY slave), which appear on the PTY master — which `node-pty` reads and hands to your `onData` callback.

Going the other direction, when you call `shell.write(data)`, `node-pty` writes to the PTY master. The data appears on the slave end's stdin, and Claude Code reads it as keyboard input. Arrow keys, Ctrl sequences, the `y/n` permission prompts — all of it works because the PTY is a full bidirectional terminal.

### Resize flow

When your browser window changes size, the chain is:

1. xterm.js detects the resize and calls `fitAddon.fit()` to recalculate dimensions
2. The new cols/rows are sent over the WebSocket as a JSON message
3. The server calls `shell.resize(cols, rows)` which sends a `SIGWINCH` signal to the PTY
4. Claude Code receives the signal, queries the new terminal size, and redraws its TUI

Without this, Claude Code's layout breaks — it'll render for 80x24 even if your phone screen is 40x60.

---

## Mobile Considerations

### Keyboard handling

xterm.js works well on mobile browsers, but some things to watch for:

- **iOS Safari**: The virtual keyboard works but may obscure the terminal. The `user-scalable=no` viewport meta tag prevents accidental zoom. You may want to add a floating button to toggle the keyboard.
- **Special keys**: Claude Code uses keys like `Escape`, `Ctrl+C`, `Tab`. On iOS you can long-press the globe key for special characters, or add on-screen buttons that send specific escape sequences.

### Optional: on-screen key bar

Add a toolbar above the terminal with buttons for common keys:

```tsx
const specialKeys = [
  { label: 'ESC', seq: '\x1b' },
  { label: 'TAB', seq: '\t' },
  { label: 'Ctrl+C', seq: '\x03' },
  { label: 'Ctrl+D', seq: '\x04' },
  { label: '↑', seq: '\x1b[A' },
  { label: '↓', seq: '\x1b[B' },
];

<div className="key-bar">
  {specialKeys.map(k => (
    <button key={k.label} onClick={() => wsRef.current?.send(k.seq)}>
      {k.label}
    </button>
  ))}
</div>
```

---

## Security Checklist

1. **Tailscale only** — Never expose port 3001 to the public internet. Tailscale ensures only your devices can reach it.
2. **Auth token** — Even behind Tailscale, require a token. Defence in depth.
3. **HTTPS** — Use Tailscale's built-in cert provisioning for TLS.
4. **API key in env vars** — Never hardcode your Anthropic API key. Keep it in the shell profile or the LaunchAgent plist.
5. **tmux session isolation** — Each WebSocket connection attaches to a named tmux session. If you want separate sessions per connection, generate unique session names.

---

## Quick Start Summary

```bash
# 1. Install prerequisites
brew install node tailscale tmux
npm install -g @anthropic-ai/claude-code

# 2. Set up the project
git clone <your-repo> ~/claude-web-terminal
cd ~/claude-web-terminal/server && npm install
cd ~/claude-web-terminal/client && npm install

# 3. Set env vars
export ANTHROPIC_API_KEY="sk-ant-..."
export TERMINAL_AUTH_TOKEN="pick-something-strong"

# 4. Build and run
cd ~/claude-web-terminal/client && npm run build
cd ~/claude-web-terminal/server && npm run dev

# 5. Open browser
# http://localhost:3001 (local)
# http://mac-mini.tailnet.ts.net:3001 (remote via Tailscale)

# 6. In the terminal, type:
claude
```

That's it. Your phone is now a Claude Code terminal.
