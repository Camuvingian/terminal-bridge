import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
    base: '/ai/',
    plugins: [react()],
    envPrefix: ['VITE_', 'TERMINAL_BRIDGE_'],
    resolve: {
        alias: {
            '@shared': path.resolve(__dirname, '../shared'),
        },
    },
    server: {
        proxy: {
            '/api': 'http://localhost:3001',
            '/ws-ai': {
                target: 'ws://localhost:3001',
                ws: true,
            },
        },
    },
});
