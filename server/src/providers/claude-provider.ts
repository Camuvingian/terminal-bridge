import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import { AgentProvider } from './agent-provider.js';
import type {
    AiServerMessage,
    AgentModelInfo,
    AgentContentBlock,
    PermissionModeValue,
} from '../../../shared/ai-protocol.js';

interface PendingPermission {
    requestId: string;
    toolName: string;
    input: Record<string, unknown>;
    description: string;
    resolve: (granted: boolean) => void;
}

/**
 * Claude Agent SDK provider.
 *
 * Wraps `@anthropic-ai/claude-agent-sdk`'s `query()` async generator and
 * translates SDK messages into the provider-agnostic `AiServerMessage` union.
 *
 * Permission handling uses a queue-based bridge: the SDK's `canUseTool`
 * callback pushes a pending permission, and the generator drains the queue
 * between SDK yields so the WebSocket handler can relay requests to the client.
 */
export class ClaudeProvider extends AgentProvider {
    readonly id = 'claude';
    readonly displayName = 'Claude (Agent SDK)';

    private model = 'claude-opus-4-6';
    private permissionMode: PermissionModeValue = 'acceptEdits';
    private pendingPermissions = new Map<string, PendingPermission>();
    private permissionCounter = 0;
    private abortController: AbortController | null = null;
    /** Maps our external session IDs → real SDK session IDs for resume. */
    private sdkSessionIds = new Map<string, string>();

    // ── Core ────────────────────────────────────────────────────────

    async *query(prompt: string, sessionId?: string): AsyncGenerator<AiServerMessage> {
        this.abortController = new AbortController();
        const startTime = Date.now();

        // Determine whether this is a resume or a fresh query.
        // Only resume if the client sends a sessionId that we have a real SDK
        // session ID for — otherwise every follow-up in the same chat would
        // erroneously try to resume with a stale/fake ID.
        const isResume = sessionId != null && this.sdkSessionIds.has(sessionId);
        const externalSessionId = sessionId ?? `session-${Date.now()}`;

        yield {
            type: 'init',
            sessionId: externalSessionId,
            model: this.model,
            permissionMode: this.permissionMode,
        };

        yield { type: 'status', status: 'querying' };

        const resultContent: AgentContentBlock[] = [];
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        let totalCacheReadTokens = 0;
        let totalCacheWriteTokens = 0;
        let totalCostUsd: number | undefined;

        try {
            const mappedMode = this.mapPermissionMode();
            const options: Record<string, unknown> = {
                allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
                permissionMode: mappedMode,
                model: this.model,
            };

            // bypassPermissions requires this flag to be set
            if (mappedMode === 'bypassPermissions') {
                options.allowDangerouslySkipPermissions = true;
            }

            // Only pass resume with a real SDK session ID
            if (isResume) {
                options.resume = this.sdkSessionIds.get(sessionId!);
            }

            const stream = sdkQuery({ prompt, options });

            for await (const message of stream) {
                if (this.abortController.signal.aborted) {
                    break;
                }

                // Capture the real SDK session ID from the init message
                if (message.type === 'system' && message.subtype === 'init' && typeof message.session_id === 'string') {
                    this.sdkSessionIds.set(externalSessionId, message.session_id);
                }

                yield* this.translateSdkMessage(message, resultContent);

                // Accumulate token usage from SDK result messages
                const raw = message as unknown as Record<string, unknown>;
                if (raw.type === 'result') {
                    // Top-level usage (snake_case from Anthropic API)
                    if (raw.usage && typeof raw.usage === 'object') {
                        const usage = raw.usage as Record<string, unknown>;
                        if (typeof usage.input_tokens === 'number') {
                            totalInputTokens += usage.input_tokens;
                        }
                        if (typeof usage.output_tokens === 'number') {
                            totalOutputTokens += usage.output_tokens;
                        }
                        if (typeof usage.cache_read_input_tokens === 'number') {
                            totalCacheReadTokens += usage.cache_read_input_tokens;
                        }
                        if (typeof usage.cache_creation_input_tokens === 'number') {
                            totalCacheWriteTokens += usage.cache_creation_input_tokens;
                        }
                    }
                    // Fallback: modelUsage (camelCase per-model breakdown)
                    if (totalInputTokens === 0 && totalCacheReadTokens === 0 && raw.modelUsage && typeof raw.modelUsage === 'object') {
                        for (const model of Object.values(raw.modelUsage as Record<string, Record<string, unknown>>)) {
                            if (typeof model.inputTokens === 'number') {
                                totalInputTokens += model.inputTokens;
                            }
                            if (typeof model.outputTokens === 'number') {
                                totalOutputTokens += model.outputTokens;
                            }
                            if (typeof model.cacheReadInputTokens === 'number') {
                                totalCacheReadTokens += model.cacheReadInputTokens;
                            }
                            if (typeof model.cacheCreationInputTokens === 'number') {
                                totalCacheWriteTokens += model.cacheCreationInputTokens;
                            }
                        }
                    }
                    // Capture cost
                    if (typeof raw.total_cost_usd === 'number') {
                        totalCostUsd = raw.total_cost_usd;
                    }
                }

                // Track text from result messages
                if ('result' in message && typeof message.result === 'string') {
                    resultContent.push({ type: 'text', text: message.result });
                }

                // Drain pending permissions between SDK yields
                yield* this.drainPermissionQueue();
            }
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            yield { type: 'error', message: errorMessage };
        } finally {
            this.abortController = null;
        }

        const durationMs = Date.now() - startTime;

        yield {
            type: 'result',
            content: resultContent,
            usage: {
                inputTokens: totalInputTokens + totalCacheReadTokens + totalCacheWriteTokens,
                outputTokens: totalOutputTokens,
                cacheReadTokens: totalCacheReadTokens || undefined,
                cacheWriteTokens: totalCacheWriteTokens || undefined,
                costUsd: totalCostUsd,
            },
            durationMs,
            sessionId: externalSessionId,
        };

        yield { type: 'status', status: 'idle' };
    }

    respondToPermission(requestId: string, granted: boolean): void {
        const pending = this.pendingPermissions.get(requestId);
        if (pending) {
            pending.resolve(granted);
            this.pendingPermissions.delete(requestId);
        }
    }

    interrupt(): void {
        if (this.abortController) {
            this.abortController.abort();
        }
    }

    // ── Models ──────────────────────────────────────────────────────

    supportedModels(): AgentModelInfo[] {
        return [
            { id: 'claude-opus-4-6', displayName: 'Claude Opus 4.6' },
            { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6' },
            { id: 'claude-haiku-4-5', displayName: 'Claude Haiku 4.5' },
        ];
    }

    setModel(modelId: string): void {
        const valid = this.supportedModels().some((m) => m.id === modelId);
        if (!valid) {
            throw new Error(`Unsupported model: "${modelId}"`);
        }
        this.model = modelId;
    }

    getActiveModel(): string {
        return this.model;
    }

    // ── Permission mode ─────────────────────────────────────────────

    setPermissionMode(mode: PermissionModeValue): void {
        this.permissionMode = mode;
    }

    getPermissionMode(): PermissionModeValue {
        return this.permissionMode;
    }

    // ── Lifecycle ───────────────────────────────────────────────────

    async dispose(): Promise<void> {
        this.interrupt();
        this.pendingPermissions.clear();
    }

    // ── Private helpers ─────────────────────────────────────────────

    private mapPermissionMode(): string {
        // Map our PermissionModeValue to SDK permission modes
        switch (this.permissionMode) {
            case 'default':
                return 'default';
            case 'plan':
                return 'plan';
            case 'acceptEdits':
                return 'acceptEdits';
            case 'dontAsk':
                return 'dontAsk';
            case 'bypassPermissions':
                return 'bypassPermissions';
            default:
                return 'default';
        }
    }

    /**
     * Translate an SDK message into zero or more AiServerMessages.
     */
    private *translateSdkMessage(message: Record<string, unknown>, resultContent: AgentContentBlock[]): Generator<AiServerMessage> {
        // The Agent SDK yields messages with various shapes.
        // We normalize them into our protocol.

        if (message.type === 'system' && message.subtype === 'init') {
            // Already sent our own init; skip.
            return;
        }

        // Assistant text content (streaming deltas)
        if (message.type === 'assistant' && typeof message.content === 'string') {
            yield { type: 'text-delta', text: message.content };
            return;
        }

        // Handle content blocks from assistant messages
        if (message.type === 'assistant' && Array.isArray(message.content)) {
            for (const block of message.content as Record<string, unknown>[]) {
                yield* this.translateContentBlock(block, resultContent);
            }
            return;
        }

        // Text result
        if ('result' in message && typeof message.result === 'string') {
            yield { type: 'text-delta', text: message.result };
            return;
        }

        // Tool use events
        if (message.type === 'tool_use') {
            const toolName = String(message.name ?? 'unknown');
            const toolUseId = String(message.id ?? `tool-${Date.now()}`);
            const input = (message.input as Record<string, unknown>) ?? {};

            yield { type: 'tool-use-start', toolUseId, toolName, input };
            resultContent.push({ type: 'tool_use', toolName, toolInput: input, toolUseId });
            return;
        }

        // Tool results
        if (message.type === 'tool_result') {
            const toolUseId = String(message.tool_use_id ?? '');
            const output = typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? '');
            const isError = message.is_error === true;

            yield { type: 'tool-result', toolUseId, output, isError, durationMs: 0 };
            resultContent.push({ type: 'tool_result', toolResult: output, toolUseId, isError });
            return;
        }
    }

    private *translateContentBlock(block: Record<string, unknown>, resultContent: AgentContentBlock[]): Generator<AiServerMessage> {
        if (block.type === 'text' && typeof block.text === 'string') {
            yield { type: 'text-delta', text: block.text };
            resultContent.push({ type: 'text', text: block.text });
        } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
            yield { type: 'thinking-delta', text: block.thinking };
            resultContent.push({ type: 'thinking', thinking: block.thinking });
        } else if (block.type === 'tool_use') {
            const toolName = String(block.name ?? 'unknown');
            const toolUseId = String(block.id ?? `tool-${Date.now()}`);
            const input = (block.input as Record<string, unknown>) ?? {};

            yield { type: 'tool-use-start', toolUseId, toolName, input };
            resultContent.push({ type: 'tool_use', toolName, toolInput: input, toolUseId });
        }
    }

    private *drainPermissionQueue(): Generator<AiServerMessage> {
        for (const [, pending] of this.pendingPermissions) {
            yield {
                type: 'permission-request',
                requestId: pending.requestId,
                toolName: pending.toolName,
                input: pending.input,
                description: pending.description,
            };
        }
    }

    /** Create a permission request that will be resolved externally. */
    createPermissionRequest(toolName: string, input: Record<string, unknown>, description: string): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            const requestId = `perm-${++this.permissionCounter}`;
            this.pendingPermissions.set(requestId, { requestId, toolName, input, description, resolve });
        });
    }
}
