import { WebSocket } from 'ws';
import type { AiClientMessage, AiServerMessage, PermissionModeValue } from '../../shared/ai-protocol.js';
import type { ProviderRegistry } from './providers/provider-registry.js';
import type { AiSession } from './ai-session.js';

/** Callback to look up an existing session by ID. */
export type GetSession = (sessionId: string) => AiSession | undefined;

/** Callback to create a new session (returns the session and its ID). */
export type CreateSession = () => AiSession;

/**
 * Thin WebSocket adapter for a single AI connection.
 *
 * Delegates query execution to `AiSession` so the query lifecycle is
 * decoupled from the WebSocket lifetime.  When the socket closes the
 * session keeps running; when a new socket reconnects it attaches to
 * the same session and receives a snapshot of accumulated state.
 *
 * SRP: owns only the WebSocket ↔ Session bridge for one connection.
 */
export class AiConnectionHandler {
    private session: AiSession | null = null;

    constructor(
        private ws: WebSocket,
        private readonly registry: ProviderRegistry,
        private readonly getSession: GetSession,
        private readonly createSession: CreateSession,
    ) {
        this.ws.on('message', (raw: Buffer) => this.onMessage(raw));
        this.ws.on('close', () => this.onClose());
    }

    // ── Inbound ─────────────────────────────────────────────────────

    private onMessage(raw: Buffer): void {
        let msg: AiClientMessage;
        try {
            msg = JSON.parse(raw.toString('utf-8')) as AiClientMessage;
        } catch {
            this.send({ type: 'error', message: 'Invalid JSON.' });
            return;
        }

        switch (msg.type) {
            case 'query':
                this.handleQuery(msg.prompt, msg.sessionId);
                break;
            case 'reconnect':
                this.handleReconnect(msg.sessionId);
                break;
            case 'permission-response':
                this.provider.respondToPermission(msg.requestId, msg.granted);
                break;
            case 'interrupt':
                this.provider.interrupt();
                break;
            case 'list-models':
                this.handleListModels();
                break;
            case 'set-model':
                this.handleSetModel(msg.modelId);
                break;
            case 'set-permission-mode':
                this.handleSetPermissionMode(msg.mode);
                break;
            default:
                this.send({ type: 'error', message: `Unknown message type.` });
        }
    }

    private onClose(): void {
        if (this.session) {
            console.log(`[~] AI client disconnected, session ${this.session.sessionId} continues running`);
            this.session.detach();
            this.session = null;
        }
    }

    // ── Command handlers ────────────────────────────────────────────

    private handleQuery(prompt: string, sessionId?: string): void {
        if (this.session && this.session.getQueryStatus() === 'querying') {
            this.send({ type: 'error', message: 'A query is already in progress.', code: 'BUSY' });
            return;
        }

        // Reuse existing session for follow-up queries so the provider
        // can resume the SDK conversation; create a new one otherwise.
        const session = (sessionId && this.getSession(sessionId)) || this.createSession();
        this.session = session;
        session.attach(this.makeSink());

        // Fire-and-forget — the session runs to completion regardless of WS state
        session.runQuery(this.provider, prompt).catch((err) => {
            console.error('[!] Unhandled error in session.runQuery:', err);
        });
    }

    private handleReconnect(sessionId: string): void {
        const existing = this.getSession(sessionId);
        if (!existing) {
            this.send({ type: 'error', message: 'Session not found.', code: 'NO_SESSION' });
            return;
        }

        console.log(`[+] AI client reconnected to session ${sessionId}`);
        this.session = existing;
        existing.attach(this.makeSink());
        existing.sendSnapshot();
    }

    private handleListModels(): void {
        const models = this.provider.supportedModels();
        const activeModel = this.provider.getActiveModel();
        this.send({ type: 'model-list', models, activeModel });
    }

    private handleSetModel(modelId: string): void {
        try {
            this.provider.setModel(modelId);
            this.handleListModels(); // echo back updated list
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.send({ type: 'error', message });
        }
    }

    private handleSetPermissionMode(mode: PermissionModeValue): void {
        try {
            this.provider.setPermissionMode(mode);
            this.send({ type: 'status', status: 'idle', message: `Permission mode set to "${mode}".` });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.send({ type: 'error', message });
        }
    }

    // ── Helpers ─────────────────────────────────────────────────────

    private get provider() {
        return this.registry.getActiveProvider();
    }

    private send(msg: AiServerMessage): void {
        if (this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(msg));
        }
    }

    /** Create a sink bound to the current WebSocket. */
    private makeSink(): (msg: AiServerMessage) => void {
        const ws = this.ws;
        return (msg: AiServerMessage) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(msg));
            }
        };
    }
}

/**
 * Authenticate an AI WebSocket connection.
 * Returns `true` if the token is valid.
 */
export function authenticateAiConnection(url: string, host: string, authToken: string): boolean {
    try {
        const parsed = new URL(url, `http://${host}`);
        return parsed.searchParams.get('token') === authToken;
    } catch {
        return false;
    }
}
