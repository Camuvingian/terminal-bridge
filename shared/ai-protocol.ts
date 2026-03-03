// AI WebSocket protocol types.
// Shared between client-ai and server — single source of truth.
//
// All AI WebSocket messages use JSON text frames (not binary).
// Each message has a `type` field for dispatching.

// ── Permission Modes ──

export type PermissionModeValue = 'default' | 'plan' | 'acceptEdits' | 'dontAsk' | 'bypassPermissions';

// ── Shared Domain Types ──

export interface AgentContentBlock {
    type: 'text' | 'tool_use' | 'tool_result' | 'thinking';
    text?: string;
    thinking?: string;
    toolName?: string;
    toolInput?: Record<string, unknown>;
    toolResult?: string;
    toolUseId?: string;
    isError?: boolean;
}

export interface AgentUsage {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    costUsd?: number;
}

export interface AgentModelInfo {
    id: string;
    displayName: string;
}

// ── Client → Server Messages ──

export interface QueryMessage {
    type: 'query';
    prompt: string;
    sessionId?: string;
}

export interface PermissionResponseMessage {
    type: 'permission-response';
    requestId: string;
    granted: boolean;
}

export interface InterruptMessage {
    type: 'interrupt';
}

export interface ListModelsMessage {
    type: 'list-models';
}

export interface SetModelMessage {
    type: 'set-model';
    modelId: string;
}

export interface SetPermissionModeMessage {
    type: 'set-permission-mode';
    mode: PermissionModeValue;
}

export type AiClientMessage =
    | QueryMessage
    | PermissionResponseMessage
    | InterruptMessage
    | ListModelsMessage
    | SetModelMessage
    | SetPermissionModeMessage;

// ── Server → Client Messages ──

export interface InitMessage {
    type: 'init';
    sessionId: string;
    model: string;
    permissionMode: PermissionModeValue;
}

export interface TextDeltaMessage {
    type: 'text-delta';
    text: string;
}

export interface AssistantMessage {
    type: 'assistant-message';
    content: AgentContentBlock[];
}

export interface ToolUseStartMessage {
    type: 'tool-use-start';
    toolUseId: string;
    toolName: string;
    input: Record<string, unknown>;
}

export interface ToolUseProgressMessage {
    type: 'tool-use-progress';
    toolUseId: string;
    text: string;
}

export interface ToolResultMessage {
    type: 'tool-result';
    toolUseId: string;
    output: string;
    isError: boolean;
    durationMs: number;
}

export interface PermissionRequestMessage {
    type: 'permission-request';
    requestId: string;
    toolName: string;
    input: Record<string, unknown>;
    description: string;
}

export interface ResultMessage {
    type: 'result';
    content: AgentContentBlock[];
    usage: AgentUsage;
    durationMs: number;
    sessionId: string;
}

export interface ErrorMessage {
    type: 'error';
    message: string;
    code?: string;
}

export interface ModelListMessage {
    type: 'model-list';
    models: AgentModelInfo[];
    activeModel: string;
}

export interface StatusMessage {
    type: 'status';
    status: 'idle' | 'querying' | 'waiting-permission';
    message?: string;
}

export interface ThinkingDeltaMessage {
    type: 'thinking-delta';
    text: string;
}

export type AiServerMessage =
    | InitMessage
    | TextDeltaMessage
    | ThinkingDeltaMessage
    | AssistantMessage
    | ToolUseStartMessage
    | ToolUseProgressMessage
    | ToolResultMessage
    | PermissionRequestMessage
    | ResultMessage
    | ErrorMessage
    | ModelListMessage
    | StatusMessage;
