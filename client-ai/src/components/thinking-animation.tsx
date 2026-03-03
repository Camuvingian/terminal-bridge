import { useState, useEffect, useRef } from 'react';
import { thinkingKeywords } from '../thinking-keywords';

const CYCLE_MS = 2500;

const ThinkingAnimation: React.FC = () => {
    const [index, setIndex] = useState<number>(() => Math.floor(Math.random() * thinkingKeywords.length));
    const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

    useEffect(() => {
        intervalRef.current = setInterval(() => {
            setIndex((prev) => (prev + 1) % thinkingKeywords.length);
        }, CYCLE_MS);

        return () => clearInterval(intervalRef.current);
    }, []);

    return (
        <span className="thinking-row">
            <span className="thinking-star-wrap">
                <span className="thinking-star">✦</span>
            </span>
            <span className="thinking-text">{thinkingKeywords[index]}</span>
        </span>
    );
};

export default ThinkingAnimation;
