import { useReducer, useCallback, useEffect } from 'react';
import type { ConnectionState } from '../app';
import { ChatContext, chatReducer, initialChatState, saveChatMessages } from '../state/chat-state';
import { useAiSocket } from '../hooks/use-ai-socket';
import { useWakeLock } from '../hooks/use-wake-lock';
import { useBackgroundNotifications } from '../hooks/use-background-notifications';
import { getSavedTheme } from '../themes';
import type { AiServerMessage } from '@shared/ai-protocol';
import ChatArea from './chat-area';
import InputBar from './input-bar';
import StatusBar from './status-bar';
import ModelSelector from './model-selector';
import PermissionDialog from './permission-dialog';
import SettingsPanel from './settings-panel';
import SessionExpiredBanner from './session-expired-banner';

interface AiChatLayoutProps {
    token: string;
    connectionState: ConnectionState;
    onConnected: () => void;
    onReconnecting: () => void;
    onDisconnect: () => void;
    onError: (msg: string) => void;
}

const AiChatLayout: React.FC<AiChatLayoutProps> = ({ token, connectionState, onConnected, onReconnecting, onDisconnect, onError }) => {
    const [state, dispatch] = useReducer(chatReducer, {
        ...initialChatState,
        theme: getSavedTheme(),
    });

    // Keep screen awake while an AI query is in-flight
    useWakeLock(state.queryStatus === 'querying');

    // Show browser notification when query completes in background
    const { notifyIfHidden } = useBackgroundNotifications();

    const handleServerMessage = useCallback((msg: AiServerMessage) => {
        dispatch({ type: 'SERVER_MESSAGE', msg });

        // Notify if the result arrived while the tab is hidden
        if (msg.type === 'result') {
            notifyIfHidden('AI response ready');
        }
    }, [notifyIfHidden]);

    const socket = useAiSocket({
        token,
        sessionId: state.sessionId,
        onMessage: handleServerMessage,
        onConnected,
        onReconnecting,
        onDisconnect,
        onError,
    });

    // Request models on connect
    useEffect(() => {
        if (connectionState === 'connected') {
            socket.send({ type: 'list-models' });
        }
    }, [connectionState, socket]);

    // Persist chat messages to localStorage whenever they change
    useEffect(() => {
        saveChatMessages(state.messages);
    }, [state.messages]);

    const handleDismissExpired = useCallback(() => {
        dispatch({ type: 'DISMISS_SESSION_EXPIRED' });
    }, []);

    const handleSend = useCallback(
        (prompt: string) => {
            dispatch({ type: 'ADD_USER_MESSAGE', prompt });
            socket.send({ type: 'query', prompt, sessionId: state.sessionId ?? undefined });
        },
        [socket, state.sessionId],
    );

    const handleInterrupt = useCallback(() => {
        socket.send({ type: 'interrupt' });
    }, [socket]);

    const handleModelChange = useCallback(
        (modelId: string) => {
            socket.send({ type: 'set-model', modelId });
        },
        [socket],
    );

    const handlePermissionResponse = useCallback(
        (requestId: string, granted: boolean) => {
            socket.send({ type: 'permission-response', requestId, granted });
        },
        [socket],
    );

    const handleNewChat = useCallback(() => {
        dispatch({ type: 'NEW_CHAT' });
    }, []);

    const handleToggleSettings = useCallback(() => {
        dispatch({ type: 'TOGGLE_SETTINGS' });
    }, []);

    const handleThemeChange = useCallback((theme: string) => {
        dispatch({ type: 'SET_THEME', theme });
    }, []);

    return (
        <ChatContext.Provider value={{ state, dispatch }}>
            <div className="ai-layout">
                <div className="main-panel">
                    <div className="chat-header">
                        <div className="chat-header-inner">
                            <div className="chat-header-left">
                                <button className="settings-btn" onClick={handleToggleSettings} title="Settings">
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                                        <circle cx="12" cy="12" r="3" />
                                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                                    </svg>
                                </button>
                                <ModelSelector models={state.models} activeModel={state.activeModel} onModelChange={handleModelChange} />
                            </div>
                            <div className="chat-header-right">
                                <StatusBar connectionState={connectionState} queryStatus={state.queryStatus} />
                                <button
                                    className="new-chat-btn"
                                    onClick={handleNewChat}
                                    disabled={state.queryStatus === 'querying'}
                                    title="New Chat"
                                >
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M12 20h9" />
                                        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                                    </svg>
                                </button>
                                <button className="disconnect-btn" onClick={onDisconnect} title="Disconnect">
                                    &#10005;
                                </button>
                            </div>
                        </div>
                    </div>
                    {state.sessionExpired && <SessionExpiredBanner onDismiss={handleDismissExpired} />}
                    <ChatArea messages={state.messages} isQuerying={state.queryStatus === 'querying'} />
                    <InputBar
                        onSend={handleSend}
                        onInterrupt={handleInterrupt}
                        isQuerying={state.queryStatus === 'querying'}
                        disabled={connectionState !== 'connected'}
                    />
                </div>
            </div>
            {state.settingsOpen && (
                <SettingsPanel currentTheme={state.theme} onThemeChange={handleThemeChange} onClose={handleToggleSettings} />
            )}
            {state.pendingPermission && <PermissionDialog permission={state.pendingPermission} onRespond={handlePermissionResponse} />}
        </ChatContext.Provider>
    );
};

export default AiChatLayout;
