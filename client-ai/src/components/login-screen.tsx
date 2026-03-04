import { useState, useCallback } from 'react';

interface LoginScreenProps {
    error: string;
    onConnect: (token: string) => void;
}

const LoginScreen: React.FC<LoginScreenProps> = ({ error, onConnect }) => {
    const [token, setToken] = useState('');

    const handleSubmit = useCallback(() => {
        onConnect(token);
    }, [token, onConnect]);

    return (
        <div className="login-container">
            <div className="login-card">
                <div className="login-header">
                    <span className="login-icon">&#9672;</span>
                    <h1>Terminal Bridge AI</h1>
                </div>
                <p className="login-subtitle">Chat with AI agents over the web</p>
                <input
                    type="password"
                    className="token-input"
                    placeholder="Auth token"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            handleSubmit();
                        }
                    }}
                    autoFocus
                />
                {error && <p className="error-text">{error}</p>}
                <button className="connect-btn" onClick={handleSubmit}>
                    Connect
                </button>
            </div>
        </div>
    );
};

export default LoginScreen;
