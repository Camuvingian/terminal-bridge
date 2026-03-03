import { useCallback, useEffect, useRef } from 'react';
import { themes, applyTheme } from '../themes';

interface SettingsPanelProps {
    currentTheme: string;
    onThemeChange: (themeId: string) => void;
    onClose: () => void;
}

const swatchColors: Record<string, string> = {
    dark: '#bc8cff',
    'neon-heist': '#d57bff',
    'neon-ice': '#00c8ff',
    vanilla: 'hsl(220 60% 30%)',
};

const SettingsPanel: React.FC<SettingsPanelProps> = ({ currentTheme, onThemeChange, onClose }) => {
    const panelRef = useRef<HTMLDivElement>(null);

    const handleThemeSelect = useCallback(
        (id: string) => {
            applyTheme(id);
            onThemeChange(id);
        },
        [onThemeChange],
    );

    // Close on Escape
    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };
        document.addEventListener('keydown', handleKey);
        return () => document.removeEventListener('keydown', handleKey);
    }, [onClose]);

    return (
        <>
            <div className="settings-overlay" onClick={onClose} />
            <div className="settings-panel" ref={panelRef}>
                <div className="settings-header">
                    <span className="settings-title">Settings</span>
                    <button className="settings-close-btn" onClick={onClose}>
                        &#10005;
                    </button>
                </div>
                <div className="settings-body">
                    <div className="settings-section-label">Theme</div>
                    <div className="theme-list">
                        {Object.entries(themes).map(([id, theme]) => (
                            <button
                                key={id}
                                className={'theme-option' + (id === currentTheme ? ' active' : '')}
                                onClick={() => handleThemeSelect(id)}
                            >
                                <span
                                    className="theme-swatch"
                                    style={{ background: swatchColors[id] ?? theme.vars['--accent'] }}
                                />
                                {theme.label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </>
    );
};

export default SettingsPanel;
