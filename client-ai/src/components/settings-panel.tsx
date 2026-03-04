import { useCallback, useEffect, useRef, useState } from 'react';
import { themes, applyTheme } from '../themes';
import { SHOW_COST_KEY } from './result-summary';

interface SettingsPanelProps {
    currentTheme: string;
    onThemeChange: (themeId: string) => void;
    onClose: () => void;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({ currentTheme, onThemeChange, onClose }) => {
    const panelRef = useRef<HTMLDivElement>(null);
    const [showCost, setShowCost] = useState(() => localStorage.getItem(SHOW_COST_KEY) === 'true');

    const handleThemeSelect = useCallback(
        (e: React.ChangeEvent<HTMLSelectElement>) => {
            const id = e.target.value;
            applyTheme(id);
            onThemeChange(id);
        },
        [onThemeChange],
    );

    const handleCostToggle = useCallback(() => {
        setShowCost((prev) => {
            const next = !prev;
            localStorage.setItem(SHOW_COST_KEY, String(next));
            return next;
        });
    }, []);

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
                    <select className="settings-select" value={currentTheme} onChange={handleThemeSelect}>
                        {Object.entries(themes).map(([id, theme]) => (
                            <option key={id} value={id}>
                                {theme.label}
                            </option>
                        ))}
                    </select>

                    <div className="settings-section-label">Display</div>
                    <label className="settings-toggle">
                        <input type="checkbox" checked={showCost} onChange={handleCostToggle} />
                        Show cost per response
                    </label>
                </div>
            </div>
        </>
    );
};

export default SettingsPanel;
