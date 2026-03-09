import express from 'express';
import { createServer, type IncomingMessage } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import type { Duplex } from 'stream';
import path from 'path';
import cors from 'cors';

import { ServerCmd } from '../../shared/protocol.js';
import { TerminalConnectionHandler, authenticateTerminalConnection } from './terminal-handler.js';
import { AiConnectionHandler, authenticateAiConnection } from './ai-handler.js';
import { AiSession } from './ai-session.js';
import { SessionStore } from './session-store.js';
import { ProviderRegistry } from './providers/provider-registry.js';
import { ClaudeProvider } from './providers/claude-provider.js';

/**
 * Central application server.
 *
 * Composes Express (HTTP), two WebSocket servers (terminal + AI), and
 * the provider registry.  Each concern lives in its own class/module
 * so the server file is a thin composition root (DIP).
 *
 * Uses `noServer` mode for both WebSocket servers so a single `upgrade`
 * handler can route by pathname — avoids the 400 handshake conflict that
 * occurs when two WSS instances share the same HTTP server.
 */
class TerminalBridgeServer {
    private readonly app = express();
    private readonly httpServer = createServer(this.app);
    private readonly terminalWss = new WebSocketServer({ noServer: true });
    private readonly aiWss = new WebSocketServer({ noServer: true });
    private readonly registry = new ProviderRegistry();
    private readonly store = new SessionStore();
    private readonly sessions = new Map<string, AiSession>();
    private cleanupInterval: ReturnType<typeof setInterval> | null = null;

    private readonly port: number;
    private readonly authToken: string;
    private readonly clientDist: string;
    private readonly clientAiDist: string;

    constructor() {
        this.port = parseInt(process.env.PORT || '3001');
        this.authToken = process.env.TERMINAL_BRIDGE_AUTH_TOKEN || 'change-me-immediately';

        // Resolve client dist directories.
        // TERMINAL_BRIDGE_ROOT is set by the CLI bin entry point (npm/npx usage).
        // Falls back to cwd-based resolution for `cd server && npm start` dev usage.
        const root = process.env.TERMINAL_BRIDGE_ROOT || path.resolve(process.cwd(), '..');
        this.clientDist = path.resolve(root, 'client', 'dist');
        this.clientAiDist = path.resolve(root, 'client-ai', 'dist');

        this.registerProviders();
        this.configureMiddleware();
        this.configureRoutes();
        this.configureUpgrade();
        this.configureWebSockets();

        // Cleanup stale session files on startup and hourly
        this.store.cleanup();
        this.cleanupInterval = setInterval(() => this.store.cleanup(), 60 * 60 * 1000);
    }

    // ── Bootstrap ───────────────────────────────────────────────────

    private registerProviders(): void {
        this.registry.register(new ClaudeProvider());
    }

    private configureMiddleware(): void {
        this.app.use(cors());
    }

    private configureRoutes(): void {
        // Serve the AI client under /ai
        this.app.use('/ai', express.static(this.clientAiDist));

        // Serve the terminal client at root
        this.app.use(express.static(this.clientDist));

        // ── REST API ────────────────────────────────────────────────

        this.app.get('/api/health', (_req, res) => {
            res.json({ status: 'ok', timestamp: new Date().toISOString() });
        });

        this.app.get('/api/ai/providers', (_req, res) => {
            res.json(this.registry.listProviders());
        });

        // SPA fallback for /ai/* (must come before the root catch-all)
        this.app.get('/ai/*', (_req, res) => {
            res.sendFile(path.join(this.clientAiDist, 'index.html'));
        });

        // SPA fallback for root terminal client
        this.app.get('*', (_req, res) => {
            res.sendFile(path.join(this.clientDist, 'index.html'));
        });
    }

    /**
     * Single upgrade handler that routes by pathname.
     *
     * This avoids the 400-handshake bug that occurs when two
     * `WebSocketServer({ server })` instances both attach their own
     * upgrade listeners to the same HTTP server.
     */
    private configureUpgrade(): void {
        this.httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
            const pathname = new URL(req.url || '', `http://${req.headers.host}`).pathname;

            if (pathname === '/ws') {
                this.terminalWss.handleUpgrade(req, socket, head, (ws) => {
                    this.terminalWss.emit('connection', ws, req);
                });
            } else if (pathname === '/ws-ai') {
                this.aiWss.handleUpgrade(req, socket, head, (ws) => {
                    this.aiWss.emit('connection', ws, req);
                });
            } else {
                socket.destroy();
            }
        });
    }

    private configureWebSockets(): void {
        // Terminal WebSocket — binary frames
        this.terminalWss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
            if (!authenticateTerminalConnection(req.url || '', req.headers.host || '', this.authToken)) {
                const payload = Buffer.from('Authentication failed.', 'utf-8');
                const msg = Buffer.alloc(1 + payload.length);
                msg[0] = ServerCmd.ALERT;
                payload.copy(msg, 1);
                ws.send(msg);
                ws.close();
                return;
            }

            console.log('[+] Terminal client connected, waiting for initial resize...');
            new TerminalConnectionHandler(ws);
        });

        // AI WebSocket — JSON text frames
        this.aiWss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
            if (!authenticateAiConnection(req.url || '', req.headers.host || '', this.authToken)) {
                ws.send(JSON.stringify({ type: 'error', message: 'Authentication failed.' }));
                ws.close();
                return;
            }

            console.log('[+] AI client connected');
            new AiConnectionHandler(
                ws,
                this.registry,
                (id) => this.sessions.get(id),
                () => {
                    const sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                    const session = new AiSession(sessionId, (id) => {
                        console.log(`[~] Cleaning up expired session ${id}`);
                        this.sessions.delete(id);
                    }, this.store);
                    this.sessions.set(sessionId, session);
                    return session;
                },
                this.store,
                (session) => this.sessions.set(session.sessionId, session),
            );
        });
    }

    // ── Public ──────────────────────────────────────────────────────

    start(): void {
        this.httpServer.on('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'EADDRINUSE') {
                console.error(`\n  Port ${this.port} is already in use.`);
                console.error(`  Kill the existing process or use a different port:`);
                console.error(`    PORT=3002 terminal-bridge\n`);
                process.exit(1);
            }
            throw err;
        });

        this.httpServer.listen(this.port, '0.0.0.0', () => {
            console.log(`Terminal Bridge running on http://0.0.0.0:${this.port}`);
            console.log(`  Terminal WS:  ws://0.0.0.0:${this.port}/ws`);
            console.log(`  AI WS:        ws://0.0.0.0:${this.port}/ws-ai`);
            console.log(`  AI Client:    http://0.0.0.0:${this.port}/ai`);
            console.log(`  Auth token:   ${this.authToken.slice(0, 4)}...`);
        });
    }

    async shutdown(): Promise<void> {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        await this.registry.disposeAll();
        this.terminalWss.close();
        this.aiWss.close();
        this.httpServer.close();
    }
}

// ── Entry point ─────────────────────────────────────────────────────

const server = new TerminalBridgeServer();
server.start();
