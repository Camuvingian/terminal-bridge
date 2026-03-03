import { useState, useCallback, useRef, useEffect } from 'react';

interface InputBarProps {
    onSend: (prompt: string) => void;
    onInterrupt: () => void;
    isQuerying: boolean;
    disabled: boolean;
}

const InputBar: React.FC<InputBarProps> = ({ onSend, onInterrupt, isQuerying, disabled }) => {
    const [text, setText] = useState('');
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Auto-grow textarea
    useEffect(() => {
        const el = textareaRef.current;
        if (el) {
            el.style.height = 'auto';
            el.style.height = Math.min(el.scrollHeight, 200) + 'px';
        }
    }, [text]);

    const handleSend = useCallback(() => {
        const prompt = text.trim();
        if (!prompt || isQuerying || disabled) {
            return;
        }
        onSend(prompt);
        setText('');
        // Reset height
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
        }
    }, [text, isQuerying, disabled, onSend]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
            }
        },
        [handleSend],
    );

    return (
        <div className="input-container">
            <div className="input-bar">
                <textarea
                    ref={textareaRef}
                    className="input-textarea"
                    placeholder={isQuerying ? 'Waiting for response...' : 'Send a message...'}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={disabled}
                    rows={1}
                />
                {isQuerying ? (
                    <button className="stop-btn" onClick={onInterrupt} title="Stop">
                        <span className="stop-icon" />
                    </button>
                ) : (
                    <button className="send-btn" onClick={handleSend} disabled={!text.trim() || disabled} title="Send">
                        &#9654;
                    </button>
                )}
            </div>
        </div>
    );
};

export default InputBar;
