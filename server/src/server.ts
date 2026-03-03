import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import * as pty from 'node-pty';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import { ClientCmd, ServerCmd } from '../../shared/protocol.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3001');
const AUTH_TOKEN = process.env.TERMINAL_BRIDGE_AUTH_TOKEN || 'change-me-immediately';

// Resolve client dist — process.cwd() is always the server/ directory
// whether running via `npm run dev` (tsx) or `npm start` (node dist/...)
const CLIENT_DIST = path.resolve(process.cwd(), '..', 'client', 'dist');

const app = express();
app.use(cors());

// Serve the built React frontend
app.use(express.static(CLIENT_DIST));

// Health check
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// SPA fallback — serve index.html for any non-API, non-WS route
app.get('*', (_req, res) => {
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
});

const server = createServer(app);

// WebSocket server on /ws path
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws: WebSocket, req) => {
    // --- AUTH ---
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (token !== AUTH_TOKEN) {
        const msg = buildServerMessage(ServerCmd.ALERT, 'Authentication failed.');
        ws.send(msg);
        ws.close();
        return;
    }

    console.log('[+] Client connected, waiting for initial resize...');

    // Defer PTY spawn until the client sends its actual dimensions.
    // This prevents tmux from rendering at 80x24 then immediately resizing,
    // which causes garbled output on reattach.
    let shell: pty.IPty | null = null;
    let paused = false;
    let outputBuffer: Buffer[] = [];

    function spawnPty(cols: number, rows: number) {
        try {
            shell = pty.spawn('/usr/local/bin/tmux', ['new-session', '-A', '-s', 'claude-web'], {
                name: 'xterm-256color',
                cols,
                rows,
                cwd: process.env.HOME || '/Users/Camus',
                env: {
                    ...process.env,
                    TERM: 'xterm-256color',
                    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
                    PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
                } as Record<string, string>,
            });
            console.log(`[+] PTY spawned (${cols}x${rows}), pid: ${shell.pid}`);
        } catch (err) {
            console.error('[!] Failed to spawn PTY:', err);
            const msg = buildServerMessage(ServerCmd.ALERT, 'Failed to spawn terminal session.');
            ws.send(msg);
            ws.close();
            return;
        }

        // --- BRIDGE: PTY output → Client ---
        shell.onData((data: string) => {
            if (ws.readyState !== WebSocket.OPEN) {
                return;
            }

            if (paused) {
                outputBuffer.push(Buffer.from(data, 'binary'));
                return;
            }

            const payload = Buffer.from(data, 'binary');
            const msg = Buffer.alloc(1 + payload.length);
            msg[0] = ServerCmd.OUTPUT;
            payload.copy(msg, 1);
            ws.send(msg);
        });

        // --- Cleanup if PTY exits ---
        shell.onExit(({ exitCode }) => {
            console.log(`[!] PTY exited with code ${exitCode}`);
            ws.close();
        });
    }

    // --- BRIDGE: Client → PTY ---
    ws.on('message', (raw: Buffer) => {
        const buf = Buffer.from(raw);
        if (buf.length === 0) {
            return;
        }

        const cmd = buf[0];
        const payload = buf.slice(1);

        switch (cmd) {
            case ClientCmd.RESIZE:
                try {
                    const { cols, rows } = JSON.parse(payload.toString('utf-8'));
                    if (typeof cols === 'number' && typeof rows === 'number') {
                        if (!shell) {
                            // First resize — spawn PTY at the correct size
                            spawnPty(cols, rows);
                        } else {
                            shell.resize(cols, rows);
                        }
                    }
                } catch {
                    // Invalid resize payload — ignore
                }
                break;

            case ClientCmd.INPUT:
                if (shell) {
                    shell.write(payload.toString('binary'));
                }
                break;

            case ClientCmd.PAUSE:
                paused = true;
                break;

            case ClientCmd.RESUME:
                paused = false;
                for (const chunk of outputBuffer) {
                    const msg = Buffer.alloc(1 + chunk.length);
                    msg[0] = ServerCmd.OUTPUT;
                    chunk.copy(msg, 1);
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(msg);
                    }
                }
                outputBuffer = [];
                break;

            default:
                console.warn(`[!] Unknown client command: 0x${cmd.toString(16)}`);
        }
    });

    // --- Cleanup on disconnect ---
    ws.on('close', () => {
        console.log('[-] Client disconnected');
        // Don't kill the PTY — tmux keeps the session alive.
    });
});

// Helper to build a server → client binary message
function buildServerMessage(cmd: number, text: string): Buffer {
    const payload = Buffer.from(text, 'utf-8');
    const msg = Buffer.alloc(1 + payload.length);
    msg[0] = cmd;
    payload.copy(msg, 1);
    return msg;
}

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Terminal Bridge running on http://0.0.0.0:${PORT}`);
    console.log(`WebSocket endpoint: ws://0.0.0.0:${PORT}/ws`);
    console.log(`Auth token: ${AUTH_TOKEN.slice(0, 4)}...`);
});
