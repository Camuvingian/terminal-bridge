export interface Theme {
    label: string;
    vars: Record<string, string>;
}

const STORAGE_KEY = 'terminal-bridge-theme';

export const themes: Record<string, Theme> = {
    dark: {
        label: 'Dark',
        vars: {
            '--bg': '#0d1117',
            '--bg-panel': '#161b22',
            '--bg-input': '#161b22',
            '--bg-hover': '#21262d',
            '--fg': '#e6edf3',
            '--fg-muted': '#8b949e',
            '--fg-dim': '#484f58',
            '--border': '#30363d',
            '--border-focus': '#bc8cff',
            '--accent': '#bc8cff',
            '--accent-hover': '#9a6eed',
            '--accent-muted': '#8957e5',
            '--success': '#3fb950',
            '--error': '#ff7b72',
            '--warning': '#d29922',
            '--contrast': '#3fb950',
        },
    },
    'neon-heist': {
        label: 'Neon Heist',
        vars: {
            '--bg': '#261d45',
            '--bg-panel': '#1e1638',
            '--bg-input': '#1a1230',
            '--bg-hover': '#352a55',
            '--fg': '#f0e6ff',
            '--fg-muted': '#a78bca',
            '--fg-dim': '#6b5694',
            '--border': '#3d2d66',
            '--border-focus': '#d57bff',
            '--accent': '#d57bff',
            '--accent-hover': '#e09eff',
            '--accent-muted': '#00ff9c',
            '--success': '#00ff9c',
            '--error': '#ff6b8a',
            '--warning': '#ffb347',
            '--contrast': '#00c8ff',
        },
    },
    'neon-ice': {
        label: 'Neon Ice',
        vars: {
            '--bg': '#0a1628',
            '--bg-panel': '#0f1d32',
            '--bg-input': '#0c1829',
            '--bg-hover': '#162440',
            '--fg': '#d4eaff',
            '--fg-muted': '#6fa8d6',
            '--fg-dim': '#3b6a96',
            '--border': '#1a3555',
            '--border-focus': '#00c8ff',
            '--accent': '#00c8ff',
            '--accent-hover': '#33d4ff',
            '--accent-muted': '#0099cc',
            '--success': '#00e5a0',
            '--error': '#ff6b8a',
            '--warning': '#ffb347',
            '--contrast': '#ff6b8a',
        },
    },
    vanilla: {
        label: 'Vanilla',
        vars: {
            '--bg': 'hsl(40 30% 96%)',
            '--bg-panel': 'hsl(40 20% 92%)',
            '--bg-input': 'hsl(40 25% 94%)',
            '--bg-hover': 'hsl(40 15% 88%)',
            '--fg': 'hsl(220 20% 20%)',
            '--fg-muted': 'hsl(220 10% 50%)',
            '--fg-dim': 'hsl(220 10% 70%)',
            '--border': 'hsl(220 15% 82%)',
            '--border-focus': 'hsl(220 60% 30%)',
            '--accent': 'hsl(220 60% 30%)',
            '--accent-hover': 'hsl(220 60% 40%)',
            '--accent-muted': 'hsl(220 50% 45%)',
            '--success': 'hsl(140 55% 35%)',
            '--error': 'hsl(0 65% 48%)',
            '--warning': 'hsl(35 80% 45%)',
            '--contrast': 'hsl(15 80% 55%)',
        },
    },
};

export function applyTheme(id: string): void {
    const theme = themes[id];
    if (!theme) {
        return;
    }
    const root = document.documentElement;
    for (const [prop, value] of Object.entries(theme.vars)) {
        root.style.setProperty(prop, value);
    }
    localStorage.setItem(STORAGE_KEY, id);
}

export function getSavedTheme(): string {
    return localStorage.getItem(STORAGE_KEY) ?? 'dark';
}
