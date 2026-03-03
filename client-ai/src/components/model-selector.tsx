import { useCallback, useState, useRef, useEffect } from 'react';
import type { AgentModelInfo } from '@shared/ai-protocol';

interface ModelSelectorProps {
    models: AgentModelInfo[];
    activeModel: string;
    onModelChange: (modelId: string) => void;
}

const ModelSelector: React.FC<ModelSelectorProps> = ({ models, activeModel, onModelChange }) => {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    const activeLabel = models.find((m) => m.id === activeModel)?.displayName ?? activeModel;

    const handleSelect = useCallback(
        (modelId: string) => {
            onModelChange(modelId);
            setOpen(false);
        },
        [onModelChange],
    );

    // Close on outside click
    useEffect(() => {
        if (!open) return;
        const handleClick = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [open]);

    if (models.length === 0) {
        return null;
    }

    return (
        <div className="model-dropdown" ref={ref}>
            <button className="model-dropdown-trigger" onClick={() => setOpen(!open)}>
                {activeLabel}
                <span className="model-dropdown-arrow">{open ? '\u25B4' : '\u25BE'}</span>
            </button>
            {open && (
                <div className="model-dropdown-menu">
                    {models.map((m) => (
                        <button
                            key={m.id}
                            className={'model-dropdown-item' + (m.id === activeModel ? ' active' : '')}
                            onClick={() => handleSelect(m.id)}
                        >
                            {m.displayName}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

export default ModelSelector;
