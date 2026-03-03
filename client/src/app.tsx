import { useState, useCallback } from 'react';
import Terminal from './terminal';

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

const App: React.FC = () => {
    const [state, setState] = useState<ConnectionState>('disconnected');
    const [token, setToken] = useState<string>('');
    const [error, setError] = useState<string>('');

    const handleConnect = useCallback(() => {
        if (!token.trim()) {
            setError('Enter auth token');
            return;
        }
        setError('');
        setState('connecting');
    }, [token]);

    const handleDisconnect = useCallback(() => {
        setState('disconnected');
    }, []);

    const handleError = useCallback((msg: string) => {
        setError(msg);
        setState('error');
    }, []);

    const handleConnected = useCallback(() => {
        setState('connected');
    }, []);

    const handleReconnecting = useCallback(() => {
        setState('reconnecting');
    }, []);

    // Login screen
    if (state === 'disconnected' || state === 'error') {
        return (
            <div className="login-container">
                <div className="login-card">
                    <div className="login-header">
                        <span className="login-icon">▸</span>
                        <h1>Terminal Bridge</h1>
                    </div>
                    <p className="login-subtitle">Web proxy into Claude Code on your Mac Mini</p>
                    <input
                        type="password"
                        className="token-input"
                        placeholder="Auth token"
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                handleConnect();
                            }
                        }}
                        autoFocus
                    />
                    {error && <p className="error-text">{error}</p>}
                    <button className="connect-btn" onClick={handleConnect}>
                        Connect
                    </button>
                </div>
            </div>
        );
    }

    // Terminal view
    const isReconnecting = state === 'reconnecting';

    return (
        <div className="terminal-container">
            <div className="terminal-header">
                <span className="terminal-title">
                    <span className={`status-dot ${isReconnecting ? 'reconnecting' : 'connected'}`} />
                    Terminal Bridge {isReconnecting ? '— Reconnecting...' : '— Mac Mini'}
                </span>
                <button className="disconnect-btn" onClick={handleDisconnect}>
                    ✕
                </button>
            </div>
            <Terminal
                token={token}
                onConnected={handleConnected}
                onError={handleError}
                onDisconnect={handleDisconnect}
                onReconnecting={handleReconnecting}
            />
        </div>
    );
};

export default App;
