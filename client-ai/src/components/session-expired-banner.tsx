import { useEffect, useState } from 'react';

interface SessionExpiredBannerProps {
    onDismiss: () => void;
}

const VISIBLE_MS = 3_000;
const POP_DURATION_MS = 400;

const SessionExpiredBanner: React.FC<SessionExpiredBannerProps> = ({ onDismiss }) => {
    const [popping, setPopping] = useState(false);

    useEffect(() => {
        const popTimer = setTimeout(() => setPopping(true), VISIBLE_MS);
        const dismissTimer = setTimeout(onDismiss, VISIBLE_MS + POP_DURATION_MS);
        return () => {
            clearTimeout(popTimer);
            clearTimeout(dismissTimer);
        };
    }, [onDismiss]);

    const handleClick = () => {
        setPopping(true);
        setTimeout(onDismiss, POP_DURATION_MS);
    };

    return (
        <div className={`session-expired-bubble ${popping ? 'popping' : ''}`} onClick={handleClick} role="alert">
            <span>Session expired — history preserved</span>
        </div>
    );
};

export default SessionExpiredBanner;
