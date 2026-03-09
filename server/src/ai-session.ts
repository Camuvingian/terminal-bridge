import type {
    AiServerMessage,
    AgentContentBlock,
    AgentUsage,
    PermissionModeValue,
    ToolUseSnapshot,
    SessionSnapshotMessage,
} from '../../shared/ai-protocol.js';
import type { AgentProvider } from './providers/agent-provider.js';
import type { SessionStore } from './session-store.js';

/** Callback that sends a message to the current WebSocket (if attached). */
export type SessionSink = (msg: AiServerMessage) => void;

/** Called by the server when a session's cleanup timer fires. */
export type SessionCleanup = (sessionId: string) => void;

const CLEANUP_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Owns the lifecycle of a single AI query.
 *
 * Decouples the query from the WebSocket connection: the query runs to
 * completion regardless of whether a client is attached.  Messages are
 * buffered in a snapshot so a reconnecting client can catch up.
 *
 * When a `SessionStore` is provided, every emitted message is persisted
 * to disk so sessions survive server restarts.
 */
export class AiSession {
    readonly sessionId: string;

    private sink: SessionSink | null = null;
    private cleanupTimer: ReturnType<typeof setTimeout> | null = null;
    private queryStatus: 'idle' | 'querying' | 'waiting-permission' = 'idle';
    private seq = 0;

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
        private readonly store?: SessionStore,
    ) {
        this.sessionId = sessionId;
    }

    /**
     * Reconstruct an AiSession from disk after a server restart.
     * Loads the snapshot to restore internal state, marks query idle.
     */
    static fromStore(sessionId: string, store: SessionStore, onCleanup: SessionCleanup): AiSession | null {
        if (!store.exists(sessionId)) {
            return null;
        }

        const session = new AiSession(sessionId, onCleanup, store);

        // Restore snapshot state from disk
        const snapshot = store.loadSnapshot(sessionId);
        if (snapshot) {
            session.model = snapshot.model;
            session.permissionMode = snapshot.permissionMode;
            session.assistantText = snapshot.assistantText;
            session.assistantThinking = snapshot.assistantThinking;
            session.toolUses = [...snapshot.toolUses];
            session.pendingPermission = snapshot.pendingPermission;
            session.resultData = snapshot.result;
        }

        // After a restart, any in-flight query is dead — mark idle
        session.queryStatus = 'idle';

        // Restore seq counter from persisted messages
        const allMessages = store.loadFrom(sessionId, 0);
        if (allMessages.length > 0) {
            session.seq = allMessages[allMessages.length - 1].seq;
        }

        return session;
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

    // ── Replay from store ────────────────────────────────────────────

    replayFrom(lastSeq: number, sink: SessionSink): boolean {
        if (!this.store) {
            return false;
        }

        const messages = this.store.loadFrom(this.sessionId, lastSeq);
        if (messages.length === 0) {
            return false;
        }

        for (const { message } of messages) {
            sink(message);
        }
        return true;
    }

    // ── Snapshot ─────────────────────────────────────────────────────

    sendSnapshot(): void {
        const snapshot = this.buildSnapshot();
        this.emit(snapshot);
    }

    private buildSnapshot(): SessionSnapshotMessage {
        return {
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
    }

    private persistSnapshot(): void {
        if (this.store) {
            this.store.saveSnapshot(this.sessionId, this.buildSnapshot());
        }
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

        // Persist snapshot on key state transitions
        if (msg.type === 'result' || msg.type === 'error' || msg.type === 'init') {
            this.persistSnapshot();
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────

    private emit(msg: AiServerMessage): void {
        // Stamp sequence number and persist (skip heartbeats and snapshots)
        if (msg.type !== 'heartbeat' && msg.type !== 'session-snapshot') {
            this.seq++;
            msg.seq = this.seq;
            if (this.store) {
                this.store.append(this.sessionId, this.seq, msg);
            }
        }

        if (this.sink) {
            this.sink(msg);
        }
    }
}
