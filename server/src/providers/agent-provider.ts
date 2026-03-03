import type { AiServerMessage, AgentModelInfo, PermissionModeValue } from '../../../shared/ai-protocol.js';

/**
 * Abstract base for all AI agent providers (Strategy pattern).
 *
 * Each concrete provider (Claude, Codex, Gemini, …) extends this class
 * and implements the abstract methods.  The `query()` method returns an
 * async generator so messages can be streamed to the client as they arrive.
 *
 * SOLID notes:
 *  • SRP — each provider owns only its SDK interaction logic.
 *  • OCP — new providers extend this class; existing code is untouched.
 *  • LSP — any subclass can substitute in the registry / handler.
 *  • ISP — thin surface; providers only implement what they can support.
 *  • DIP — the handler depends on this abstraction, never on a concrete class.
 */
export abstract class AgentProvider {
    /** Unique identifier used in the registry and REST API. */
    abstract readonly id: string;

    /** Human-readable name shown in the client UI. */
    abstract readonly displayName: string;

    // ── Core operations ─────────────────────────────────────────────

    /**
     * Send a prompt to the AI and stream back responses.
     * If `sessionId` is provided the provider should resume that session.
     */
    abstract query(prompt: string, sessionId?: string): AsyncGenerator<AiServerMessage>;

    /** Respond to a pending permission request. */
    abstract respondToPermission(requestId: string, granted: boolean): void;

    /** Interrupt the currently-running query. */
    abstract interrupt(): void;

    // ── Model management ────────────────────────────────────────────

    abstract supportedModels(): AgentModelInfo[];

    abstract setModel(modelId: string): void;

    abstract getActiveModel(): string;

    // ── Permission mode ─────────────────────────────────────────────

    abstract setPermissionMode(mode: PermissionModeValue): void;

    abstract getPermissionMode(): PermissionModeValue;

    // ── Lifecycle ───────────────────────────────────────────────────

    /** Clean up resources (child processes, open handles, etc.). */
    abstract dispose(): Promise<void>;
}
