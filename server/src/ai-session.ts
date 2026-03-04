import type {
    AiServerMessage,
    AgentContentBlock,
    AgentUsage,
    PermissionModeValue,
    ToolUseSnapshot,
    SessionSnapshotMessage,
} from '../../shared/ai-protocol.js';
import type { AgentProvider } from './providers/agent-provider.js';

/** Callback that sends a message to the current WebSocket (if attached). */
export type SessionSink = (msg: AiServerMessage) => void;

/** Called by the server when a session's cleanup timer fires. */
export type SessionCleanup = (sessionId: string) => void;

const CLEANUP_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes

/**
 * Owns the lifecycle of a single AI query.
 *
 * Decouples the query from the WebSocket connection: the query runs to
 * completion regardless of whether a client is attached.  Messages are
 * buffered in a snapshot so a reconnecting client can catch up.
 */
export class AiSession {
    readonly sessionId: string;

    private sink: SessionSink | null = null;
    private cleanupTimer: ReturnType<typeof setTimeout> | null = null;
    private queryStatus: 'idle' | 'querying' | 'waiting-permission' = 'idle';

    // ── Snapshot state ───────────────────────────────────────────────
    private assistantText = '';
    private assistantThinking = '';
    private toolUses: ToolUseSnapshot[] = [];
    private pendingPermission: SessionSnapshotMessage['pendingPermission'] = null;
    private resultData: SessionSnapshotMessage['result'] = null;
    private model = '';
    private permissionMode: PermissionModeValue = 'default';

    constructor(
        sessionId: string,
        private readonly onCleanup: SessionCleanup,
    ) {
        this.sessionId = sessionId;
    }

    // ── Attach / Detach ──────────────────────────────────────────────

    attach(sink: SessionSink): void {
        this.sink = sink;
        if (this.cleanupTimer) {
            clearTimeout(this.cleanupTimer);
            this.cleanupTimer = null;
        }
    }

    detach(): void {
        this.sink = null;
        // Start cleanup timer — if no client reconnects, dispose the session
        this.cleanupTimer = setTimeout(() => {
            this.onCleanup(this.sessionId);
        }, CLEANUP_TIMEOUT_MS);
    }

    isAttached(): boolean {
        return this.sink !== null;
    }

    getQueryStatus(): string {
        return this.queryStatus;
    }

    // ── Query execution ──────────────────────────────────────────────

    async runQuery(provider: AgentProvider, prompt: string): Promise<void> {
        this.queryStatus = 'querying';
        this.assistantText = '';
        this.assistantThinking = '';
        this.toolUses = [];
        this.pendingPermission = null;
        this.resultData = null;

        try {
            // Always pass this session's ID to the provider so the init
            // message's sessionId matches our key in the server's sessions Map.
            for await (const msg of provider.query(prompt, this.sessionId)) {
                this.updateSnapshot(msg);
                this.emit(msg);
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const errorMsg: AiServerMessage = { type: 'error', message };
            this.updateSnapshot(errorMsg);
            this.emit(errorMsg);
        }
    }

    // ── Snapshot ─────────────────────────────────────────────────────

    sendSnapshot(): void {
        const snapshot: SessionSnapshotMessage = {
            type: 'session-snapshot',
            sessionId: this.sessionId,
            model: this.model,
            permissionMode: this.permissionMode,
            queryStatus: this.queryStatus,
            assistantText: this.assistantText,
            assistantThinking: this.assistantThinking,
            toolUses: this.toolUses,
            pendingPermission: this.pendingPermission,
            result: this.resultData,
        };
        this.emit(snapshot);
    }

    private updateSnapshot(msg: AiServerMessage): void {
        switch (msg.type) {
            case 'init':
                this.model = msg.model;
                this.permissionMode = msg.permissionMode;
                break;

            case 'status':
                this.queryStatus = msg.status;
                break;

            case 'text-delta':
                this.assistantText += msg.text;
                break;

            case 'thinking-delta':
                this.assistantThinking += msg.text;
                break;

            case 'tool-use-start':
                this.toolUses.push({
                    toolUseId: msg.toolUseId,
                    toolName: msg.toolName,
                    input: msg.input,
                    status: 'running',
                });
                break;

            case 'tool-use-progress': {
                const tool = this.toolUses.find((t) => t.toolUseId === msg.toolUseId);
                if (tool) {
                    tool.output = (tool.output ?? '') + msg.text;
                }
                break;
            }

            case 'tool-result': {
                const tool = this.toolUses.find((t) => t.toolUseId === msg.toolUseId);
                if (tool) {
                    tool.output = msg.output;
                    tool.isError = msg.isError;
                    tool.durationMs = msg.durationMs;
                    tool.status = msg.isError ? 'error' : 'success';
                }
                break;
            }

            case 'permission-request':
                this.queryStatus = 'waiting-permission';
                this.pendingPermission = {
                    requestId: msg.requestId,
                    toolName: msg.toolName,
                    input: msg.input,
                    description: msg.description,
                };
                break;

            case 'result':
                this.queryStatus = 'idle';
                this.resultData = {
                    content: msg.content,
                    usage: msg.usage,
                    durationMs: msg.durationMs,
                };
                break;

            case 'error':
                this.queryStatus = 'idle';
                break;
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────

    private emit(msg: AiServerMessage): void {
        if (this.sink) {
            this.sink(msg);
        }
    }
}
