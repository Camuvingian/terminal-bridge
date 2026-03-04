#!/usr/bin/env node

/**
 * Terminal Bridge CLI
 *
 * Starts the Terminal Bridge server and prints connection URLs.
 * Auto-detects Tailscale IP for remote access.
 */

import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

// Tell the server where to find client dist dirs
process.env.TERMINAL_BRIDGE_ROOT = ROOT;

function getTailscaleIp() {
    // Try `tailscale ip -4` first (most reliable)
    try {
        const ip = execSync('tailscale ip -4', { timeout: 3000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
        if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
            return ip;
        }
    } catch {
        // tailscale CLI not available or not connected
    }

    // Fallback: scan network interfaces for 100.x.x.x (Tailscale CGNAT range)
    const interfaces = os.networkInterfaces();
    for (const [name, addrs] of Object.entries(interfaces)) {
        if (!addrs) {
            continue;
        }
        for (const addr of addrs) {
            if (addr.family === 'IPv4' && addr.address.startsWith('100.')) {
                return addr.address;
            }
        }
    }

    return null;
}

const port = process.env.PORT || '3001';
const tailscaleIp = getTailscaleIp();

console.log('');
console.log('  ╔══════════════════════════════════════╗');
console.log('  ║         Terminal Bridge              ║');
console.log('  ╚══════════════════════════════════════╝');
console.log('');

if (tailscaleIp) {
    console.log(`  Tailscale IP detected: ${tailscaleIp}`);
    console.log('');
    console.log('  Remote URLs (Tailscale):');
    console.log(`    Terminal:  http://${tailscaleIp}:${port}/`);
    console.log(`    AI Chat:   http://${tailscaleIp}:${port}/ai`);
    console.log('');
} else {
    console.warn('  ⚠  Tailscale not detected. Remote access will not work.');
    console.warn('');
    console.warn('     Install Tailscale for remote access from your other devices:');
    console.warn('       macOS:  brew install --cask tailscale');
    console.warn('       Linux:  https://tailscale.com/download/linux');
    console.warn('');
    console.warn('     After installing, run `tailscale up` and restart Terminal Bridge.');
    console.warn('');
}

console.log('  Local URLs:');
console.log(`    Terminal:  http://localhost:${port}/`);
console.log(`    AI Chat:   http://localhost:${port}/ai`);
console.log('');

if (!process.env.TERMINAL_BRIDGE_AUTH_TOKEN || process.env.TERMINAL_BRIDGE_AUTH_TOKEN === 'change-me-immediately') {
    console.warn('  ⚠  TERMINAL_BRIDGE_AUTH_TOKEN is not set or using the default.');
    console.warn('     Set it in your shell profile for security:');
    console.warn('     export TERMINAL_BRIDGE_AUTH_TOKEN="your-secret-token"');
    console.warn('');
}

if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('  ⚠  ANTHROPIC_API_KEY is not set. AI chat will not work.');
    console.warn('     export ANTHROPIC_API_KEY="sk-ant-..."');
    console.warn('');
}

// Check tmux
try {
    execSync('which tmux', { timeout: 2000, encoding: 'utf-8' });
} catch {
    console.warn('  ⚠  tmux not found. Terminal sessions require tmux.');
    console.warn('     Install with: brew install tmux');
    console.warn('');
}

const serverEntry = path.join(ROOT, 'server', 'dist', 'server', 'src', 'server.js');

try {
    await import(serverEntry);
} catch (err) {
    console.error('');
    console.error('  Failed to start server:', err.message);
    console.error('');
    console.error('  If you installed from npm, make sure native dependencies compiled:');
    console.error('    npm rebuild node-pty');
    console.error('');
    process.exit(1);
}
