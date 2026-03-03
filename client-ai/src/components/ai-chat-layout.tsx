import { useReducer, useCallback, useEffect } from 'react';
import type { ConnectionState } from '../app';
import { ChatContext, chatReducer, initialChatState } from '../state/chat-state';
import { useAiSocket } from '../hooks/use-ai-socket';
import { getSavedTheme } from '../themes';
import type { AiServerMessage } from '@shared/ai-protocol';
import ChatArea from './chat-area';
import InputBar from './input-bar';
import StatusBar from './status-bar';
import ModelSelector from './model-selector';
import PermissionDialog from './permission-dialog';
import SettingsPanel from './settings-panel';

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

    const handleServerMessage = useCallback((msg: AiServerMessage) => {
        dispatch({ type: 'SERVER_MESSAGE', msg });
    }, []);

    const socket = useAiSocket({
        token,
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
                        <div className="chat-header-left">
                            <button className="settings-btn" onClick={handleToggleSettings} title="Settings">
                                &#9881;
                            </button>
                            <ModelSelector models={state.models} activeModel={state.activeModel} onModelChange={handleModelChange} />
                        </div>
                        <div className="chat-header-right">
                            <StatusBar connectionState={connectionState} queryStatus={state.queryStatus} />
                            <button className="disconnect-btn" onClick={onDisconnect} title="Disconnect">
                                &#10005;
                            </button>
                        </div>
                    </div>
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
