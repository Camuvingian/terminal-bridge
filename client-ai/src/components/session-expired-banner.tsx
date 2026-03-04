import { useEffect } from 'react';

interface SessionExpiredBannerProps {
    onDismiss: () => void;
}

const AUTO_DISMISS_MS = 8_000;

const SessionExpiredBanner: React.FC<SessionExpiredBannerProps> = ({ onDismiss }) => {
    useEffect(() => {
        const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
        return () => clearTimeout(timer);
    }, [onDismiss]);

    return (
        <div className="session-expired-banner" onClick={onDismiss} role="alert">
            <span className="session-expired-icon">&#9888;</span>
            <span>Session timed out — your conversation history has been preserved</span>
        </div>
    );
};

export default SessionExpiredBanner;
