import { WebSocket } from 'ws';
import type { AiClientMessage, AiServerMessage, PermissionModeValue } from '../../shared/ai-protocol.js';
import type { ProviderRegistry } from './providers/provider-registry.js';

/**
 * Handles a single AI WebSocket connection.
 *
 * Parses incoming JSON frames, dispatches to the active provider,
 * and streams `AiServerMessage` frames back to the client.
 *
 * SRP: owns only the WebSocket ↔ Provider bridge for one connection.
 */
export class AiConnectionHandler {
    private isQuerying = false;

    constructor(
        private readonly ws: WebSocket,
        private readonly registry: ProviderRegistry,
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
        if (this.isQuerying) {
            this.provider.interrupt();
        }
    }

    // ── Command handlers ────────────────────────────────────────────

    private async handleQuery(prompt: string, sessionId?: string): Promise<void> {
        if (this.isQuerying) {
            this.send({ type: 'error', message: 'A query is already in progress.', code: 'BUSY' });
            return;
        }

        this.isQuerying = true;

        try {
            for await (const msg of this.provider.query(prompt, sessionId)) {
                if (this.ws.readyState !== WebSocket.OPEN) {
                    break;
                }
                this.send(msg);
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.send({ type: 'error', message });
        } finally {
            this.isQuerying = false;
        }
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
