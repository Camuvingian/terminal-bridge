import { createContext, useContext } from 'react';
import type {
    AiServerMessage,
    AgentContentBlock,
    AgentUsage,
    AgentModelInfo,
    PermissionModeValue,
    SessionSnapshotMessage,
} from '@shared/ai-protocol';

// ── Persistence Helpers ──────────────────────────────────────────────

const SESSION_ID_KEY = 'terminal-bridge-session-id';
const CHAT_MESSAGES_KEY = 'terminal-bridge-chat-messages';
const MAX_PERSISTED_MESSAGES = 50;

export function saveSessionId(sessionId: string): void {
    try {
        sessionStorage.setItem(SESSION_ID_KEY, sessionId);
    } catch { /* quota exceeded — ignore */ }
}

export function loadSessionId(): string | null {
    try {
        return sessionStorage.getItem(SESSION_ID_KEY);
    } catch {
        return null;
    }
}

export function clearSessionId(): void {
    try {
        sessionStorage.removeItem(SESSION_ID_KEY);
    } catch { /* ignore */ }
}

export function saveChatMessages(messages: ChatMessage[]): void {
    try {
        const trimmed = messages.slice(-MAX_PERSISTED_MESSAGES);
        localStorage.setItem(CHAT_MESSAGES_KEY, JSON.stringify(trimmed));
    } catch { /* quota exceeded — ignore */ }
}

export function loadChatMessages(): ChatMessage[] {
    try {
        const raw = localStorage.getItem(CHAT_MESSAGES_KEY);
        if (!raw) {
            return [];
        }
        const parsed = JSON.parse(raw) as ChatMessage[];
        return Array.isArray(parsed) ? parsed.slice(-MAX_PERSISTED_MESSAGES) : [];
    } catch {
        return [];
    }
}

export function clearChatMessages(): void {
    try {
        localStorage.removeItem(CHAT_MESSAGES_KEY);
    } catch { /* ignore */ }
}

// ── Types ───────────────────────────────────────────────────────────

export interface ToolUseEntry {
    toolUseId: string;
    toolName: string;
    input: Record<string, unknown>;
    output?: string;
    isError?: boolean;
    durationMs?: number;
    status: 'running' | 'success' | 'error';
}

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    text: string;
    thinking?: string;
    toolUses: ToolUseEntry[];
    content?: AgentContentBlock[];
    usage?: AgentUsage;
    durationMs?: number;
    timestamp: number;
}

export interface PermissionRequest {
    requestId: string;
    toolName: string;
    input: Record<string, unknown>;
    description: string;
}

export interface ChatState {
    messages: ChatMessage[];
    sessionId: string | null;
    models: AgentModelInfo[];
    activeModel: string;
    permissionMode: PermissionModeValue;
    queryStatus: 'idle' | 'querying' | 'waiting-permission';
    pendingPermission: PermissionRequest | null;
    streamingMessageId: string | null;
    settingsOpen: boolean;
    theme: string;
    lastPromptTokens: number;
    sessionExpired: boolean;
}

export const initialChatState: ChatState = {
    messages: loadChatMessages(),
    sessionId: loadSessionId(),
    models: [],
    activeModel: '',
    permissionMode: 'default',
    queryStatus: 'idle',
    pendingPermission: null,
    streamingMessageId: null,
    settingsOpen: false,
    theme: 'dark',
    lastPromptTokens: 0,
    sessionExpired: false,
};

// ── Actions ─────────────────────────────────────────────────────────

export type ChatAction =
    | { type: 'ADD_USER_MESSAGE'; prompt: string }
    | { type: 'SERVER_MESSAGE'; msg: AiServerMessage }
    | { type: 'TOGGLE_SETTINGS' }
    | { type: 'SET_THEME'; theme: string }
    | { type: 'DISMISS_SESSION_EXPIRED' }
    | { type: 'NEW_CHAT' };

// ── Reducer ─────────────────────────────────────────────────────────

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
    switch (action.type) {
        case 'ADD_USER_MESSAGE': {
            const id = `user-${Date.now()}`;
            const userMsg: ChatMessage = {
                id,
                role: 'user',
                text: action.prompt,
                toolUses: [],
                timestamp: Date.now(),
            };
            return {
                ...state,
                messages: [...state.messages, userMsg],
                lastPromptTokens: estimateTokenCount(action.prompt),
            };
        }

        case 'SERVER_MESSAGE':
            return handleServerMessage(state, action.msg);

        case 'TOGGLE_SETTINGS':
            return { ...state, settingsOpen: !state.settingsOpen };

        case 'SET_THEME':
            return { ...state, theme: action.theme };

        case 'DISMISS_SESSION_EXPIRED':
            return { ...state, sessionExpired: false };

        case 'NEW_CHAT':
            clearSessionId();
            clearChatMessages();
            return {
                ...state,
                messages: [],
                sessionId: null,
                streamingMessageId: null,
                queryStatus: 'idle',
                pendingPermission: null,
                sessionExpired: false,
            };

        default:
            return state;
    }
}

function handleServerMessage(state: ChatState, msg: AiServerMessage): ChatState {
    switch (msg.type) {
        case 'init':
            saveSessionId(msg.sessionId);
            return {
                ...state,
                sessionId: msg.sessionId,
                activeModel: msg.model,
                permissionMode: msg.permissionMode,
            };

        case 'status':
            return { ...state, queryStatus: msg.status };

        case 'text-delta': {
            return appendToAssistantText(state, msg.text);
        }

        case 'thinking-delta': {
            return appendToAssistantThinking(state, msg.text);
        }

        case 'tool-use-start': {
            const entry: ToolUseEntry = {
                toolUseId: msg.toolUseId,
                toolName: msg.toolName,
                input: msg.input,
                status: 'running',
            };
            return addToolUseToAssistant(state, entry);
        }

        case 'tool-use-progress': {
            return updateToolUseOutput(state, msg.toolUseId, msg.text);
        }

        case 'tool-result': {
            return completeToolUse(state, msg.toolUseId, msg.output, msg.isError, msg.durationMs);
        }

        case 'permission-request':
            return {
                ...state,
                queryStatus: 'waiting-permission',
                pendingPermission: {
                    requestId: msg.requestId,
                    toolName: msg.toolName,
                    input: msg.input,
                    description: msg.description,
                },
            };

        case 'result': {
            // Override inputTokens with the estimated prompt tokens
            const usage = msg.usage
                ? { ...msg.usage, inputTokens: state.lastPromptTokens }
                : undefined;
            const s = finalizeAssistantMessage(state, usage, msg.durationMs);
            return { ...s, queryStatus: 'idle', streamingMessageId: null };
        }

        case 'error': {
            const s = appendToAssistantText(state, `\n[Error: ${msg.message}]`);
            return { ...s, queryStatus: 'idle', streamingMessageId: null };
        }

        case 'model-list':
            return { ...state, models: msg.models, activeModel: msg.activeModel };

        case 'session-snapshot':
            saveSessionId(msg.sessionId);
            return handleSessionSnapshot(state, msg);

        case 'session-expired':
            clearSessionId();
            return {
                ...state,
                sessionExpired: true,
                sessionId: null,
                streamingMessageId: null,
                queryStatus: 'idle',
            };

        default:
            return state;
    }
}

// ── Snapshot handling ─────────────────────────────────────────────────

function handleSessionSnapshot(state: ChatState, snap: SessionSnapshotMessage): ChatState {
    const hasContent = snap.assistantText || snap.assistantThinking || snap.toolUses.length > 0;
    if (!hasContent && !snap.result) {
        // Empty snapshot — just update metadata
        return {
            ...state,
            sessionId: snap.sessionId,
            activeModel: snap.model,
            permissionMode: snap.permissionMode,
            queryStatus: snap.queryStatus,
        };
    }

    const toolUses: ToolUseEntry[] = snap.toolUses.map((t) => ({
        toolUseId: t.toolUseId,
        toolName: t.toolName,
        input: t.input,
        output: t.output,
        isError: t.isError,
        durationMs: t.durationMs,
        status: t.status,
    }));

    // Build the restored assistant message
    const restoredMsg: ChatMessage = {
        id: state.streamingMessageId ?? `assistant-${Date.now()}`,
        role: 'assistant',
        text: snap.assistantText,
        thinking: snap.assistantThinking || undefined,
        toolUses,
        usage: snap.result?.usage,
        durationMs: snap.result?.durationMs,
        timestamp: Date.now(),
    };

    // Replace existing streaming message or append — but skip if the
    // last message already matches (avoids duplicates on reconnect).
    let messages: ChatMessage[];
    if (state.streamingMessageId) {
        messages = state.messages.map((m) => (m.id === state.streamingMessageId ? restoredMsg : m));
    } else {
        const last = state.messages[state.messages.length - 1];
        const alreadyHas = last?.role === 'assistant' && last.text === snap.assistantText && snap.queryStatus === 'idle';
        if (alreadyHas) {
            messages = state.messages;
        } else {
            messages = [...state.messages, restoredMsg];
        }
    }

    const isFinished = snap.queryStatus === 'idle';

    return {
        ...state,
        messages,
        sessionId: snap.sessionId,
        activeModel: snap.model,
        permissionMode: snap.permissionMode,
        queryStatus: snap.queryStatus,
        streamingMessageId: isFinished ? null : restoredMsg.id,
        pendingPermission: snap.pendingPermission
            ? {
                  requestId: snap.pendingPermission.requestId,
                  toolName: snap.pendingPermission.toolName,
                  input: snap.pendingPermission.input,
                  description: snap.pendingPermission.description,
              }
            : null,
    };
}

// ── Helpers ──────────────────────────────────────────────────────────

function ensureAssistantMessage(state: ChatState): ChatState {
    if (state.streamingMessageId) {
        return state;
    }
    const id = `assistant-${Date.now()}`;
    const msg: ChatMessage = {
        id,
        role: 'assistant',
        text: '',
        toolUses: [],
        timestamp: Date.now(),
    };
    return {
        ...state,
        messages: [...state.messages, msg],
        streamingMessageId: id,
    };
}

function appendToAssistantText(state: ChatState, text: string): ChatState {
    const s = ensureAssistantMessage(state);
    return {
        ...s,
        messages: s.messages.map((m) => (m.id === s.streamingMessageId ? { ...m, text: m.text + text } : m)),
    };
}

function appendToAssistantThinking(state: ChatState, text: string): ChatState {
    const s = ensureAssistantMessage(state);
    return {
        ...s,
        messages: s.messages.map((m) => (m.id === s.streamingMessageId ? { ...m, thinking: (m.thinking ?? '') + text } : m)),
    };
}

function addToolUseToAssistant(state: ChatState, entry: ToolUseEntry): ChatState {
    const s = ensureAssistantMessage(state);
    return {
        ...s,
        messages: s.messages.map((m) => (m.id === s.streamingMessageId ? { ...m, toolUses: [...m.toolUses, entry] } : m)),
    };
}

function updateToolUseOutput(state: ChatState, toolUseId: string, text: string): ChatState {
    return {
        ...state,
        messages: state.messages.map((m) => ({
            ...m,
            toolUses: m.toolUses.map((t) => (t.toolUseId === toolUseId ? { ...t, output: (t.output ?? '') + text } : t)),
        })),
    };
}

function completeToolUse(state: ChatState, toolUseId: string, output: string, isError: boolean, durationMs: number): ChatState {
    return {
        ...state,
        messages: state.messages.map((m) => ({
            ...m,
            toolUses: m.toolUses.map((t) =>
                t.toolUseId === toolUseId
                    ? { ...t, output, isError, durationMs, status: isError ? ('error' as const) : ('success' as const) }
                    : t,
            ),
        })),
    };
}

function finalizeAssistantMessage(state: ChatState, usage?: AgentUsage, durationMs?: number): ChatState {
    if (!state.streamingMessageId) {
        return state;
    }
    return {
        ...state,
        messages: state.messages.map((m) => (m.id === state.streamingMessageId ? { ...m, usage, durationMs } : m)),
    };
}

/**
 * Rough token estimate that splits on word boundaries and punctuation.
 * Approximates Claude's BPE tokenizer for English text.
 */
function estimateTokenCount(text: string): number {
    return text.match(/\w+|[^\s\w]/g)?.length ?? 0;
}

// ── Context ─────────────────────────────────────────────────────────

interface ChatContextValue {
    state: ChatState;
    dispatch: React.Dispatch<ChatAction>;
}

export const ChatContext = createContext<ChatContextValue>({
    state: initialChatState,
    dispatch: () => {},
});

export function useChatContext() {
    return useContext(ChatContext);
}
