import { useState, useCallback, useEffect } from 'react';
import LoginScreen from './components/login-screen';
import AiChatLayout from './components/ai-chat-layout';
import { applyTheme, getSavedTheme } from './themes';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

const envToken = import.meta.env.TERMINAL_BRIDGE_AUTH_TOKEN as string | undefined;

const App: React.FC = () => {
    // Restore saved theme on mount
    useEffect(() => {
        applyTheme(getSavedTheme());
    }, []);

    const [state, setState] = useState<ConnectionState>(envToken ? 'connecting' : 'disconnected');
    const [token, setToken] = useState<string>(envToken ?? '');
    const [error, setError] = useState<string>('');

    const handleConnect = useCallback((t: string) => {
        if (!t.trim()) {
            setError('Enter auth token');
            return;
        }
        setError('');
        setToken(t);
        setState('connecting');
    }, []);

    const handleConnected = useCallback(() => {
        setState('connected');
    }, []);

    const handleReconnecting = useCallback(() => {
        setState('reconnecting');
    }, []);

    const handleDisconnect = useCallback(() => {
        setState('disconnected');
        setToken('');
    }, []);

    const handleError = useCallback((msg: string) => {
        setError(msg);
        setState('error');
    }, []);

    if (state === 'disconnected' || state === 'error') {
        return <LoginScreen error={error} onConnect={handleConnect} />;
    }

    return (
        <AiChatLayout
            token={token}
            connectionState={state}
            onConnected={handleConnected}
            onReconnecting={handleReconnecting}
            onDisconnect={handleDisconnect}
            onError={handleError}
        />
    );
};

export default App;
