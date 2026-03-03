import { createContext, useContext } from 'react';
import type {
    AiServerMessage,
    AgentContentBlock,
    AgentUsage,
    AgentModelInfo,
    PermissionModeValue,
} from '@shared/ai-protocol';

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
}

export const initialChatState: ChatState = {
    messages: [],
    sessionId: null,
    models: [],
    activeModel: '',
    permissionMode: 'default',
    queryStatus: 'idle',
    pendingPermission: null,
    streamingMessageId: null,
    settingsOpen: false,
    theme: 'dark',
};

// ── Actions ─────────────────────────────────────────────────────────

export type ChatAction =
    | { type: 'ADD_USER_MESSAGE'; prompt: string }
    | { type: 'SERVER_MESSAGE'; msg: AiServerMessage }
    | { type: 'TOGGLE_SETTINGS' }
    | { type: 'SET_THEME'; theme: string };

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
            return { ...state, messages: [...state.messages, userMsg] };
        }

        case 'SERVER_MESSAGE':
            return handleServerMessage(state, action.msg);

        case 'TOGGLE_SETTINGS':
            return { ...state, settingsOpen: !state.settingsOpen };

        case 'SET_THEME':
            return { ...state, theme: action.theme };

        default:
            return state;
    }
}

function handleServerMessage(state: ChatState, msg: AiServerMessage): ChatState {
    switch (msg.type) {
        case 'init':
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
            const s = finalizeAssistantMessage(state, msg.usage, msg.durationMs);
            return { ...s, queryStatus: 'idle', streamingMessageId: null };
        }

        case 'error': {
            const s = appendToAssistantText(state, `\n[Error: ${msg.message}]`);
            return { ...s, queryStatus: 'idle', streamingMessageId: null };
        }

        case 'model-list':
            return { ...state, models: msg.models, activeModel: msg.activeModel };

        default:
            return state;
    }
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
