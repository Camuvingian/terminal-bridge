interface KeyBarProps {
    onSend: (data: string) => void;
}

const specialKeys = [
    { label: 'ESC', seq: '\x1b' },
    { label: 'TAB', seq: '\t' },
    { label: 'Ctrl+C', seq: '\x03' },
    { label: 'Ctrl+D', seq: '\x04' },
    { label: 'Ctrl+Z', seq: '\x1a' },
    { label: '\u2191', seq: '\x1b[A' }, // Up arrow
    { label: '\u2193', seq: '\x1b[B' }, // Down arrow
    { label: '\u2190', seq: '\x1b[D' }, // Left arrow
    { label: '\u2192', seq: '\x1b[C' }, // Right arrow
];

const KeyBar: React.FC<KeyBarProps> = ({ onSend }) => {
    return (
        <div className="key-bar">
            {specialKeys.map((k) => (
                <button
                    key={k.label}
                    onClick={() => onSend(k.seq)}
                    onMouseDown={(e) => e.preventDefault()} // Prevent terminal blur
                >
                    {k.label}
                </button>
            ))}
        </div>
    );
};

export default KeyBar;
