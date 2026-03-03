import { useState } from 'react';

interface ThinkingBlockProps {
    text: string;
}

const ThinkingBlock: React.FC<ThinkingBlockProps> = ({ text }) => {
    const [expanded, setExpanded] = useState(false);

    return (
        <div className="thinking-block">
            <div className="thinking-header" onClick={() => setExpanded(!expanded)}>
                <span>{expanded ? '\u25BC' : '\u25B6'}</span>
                <span>Thinking</span>
            </div>
            {expanded && <div className="thinking-content">{text}</div>}
        </div>
    );
};

export default ThinkingBlock;
