import { WebSocket } from 'ws';
import * as pty from 'node-pty';
import { ClientCmd, ServerCmd } from '../../shared/protocol.js';

/**
 * Handles a single terminal WebSocket connection.
 *
 * Bridges a browser WebSocket (binary frames) ↔ a PTY/tmux session.
 * SRP: owns only the WebSocket ↔ PTY bridge for one connection.
 */
export class TerminalConnectionHandler {
    private shell: pty.IPty | null = null;
    private paused = false;
    private outputBuffer: Buffer[] = [];

    constructor(private readonly ws: WebSocket) {
        this.ws.on('message', (raw: Buffer) => this.onMessage(raw));
        this.ws.on('close', () => this.onClose());
    }

    // ── Inbound ─────────────────────────────────────────────────────

    private onMessage(raw: Buffer): void {
        const buf = Buffer.from(raw);
        if (buf.length === 0) {
            return;
        }

        const cmd = buf[0];
        const payload = buf.slice(1);

        switch (cmd) {
            case ClientCmd.RESIZE:
                this.handleResize(payload);
                break;
            case ClientCmd.INPUT:
                this.handleInput(payload);
                break;
            case ClientCmd.PAUSE:
                this.paused = true;
                break;
            case ClientCmd.RESUME:
                this.handleResume();
                break;
            default:
                console.warn(`[!] Unknown client command: 0x${cmd.toString(16)}`);
        }
    }

    private onClose(): void {
        console.log('[-] Terminal client disconnected');
        // Don't kill the PTY — tmux keeps the session alive.
    }

    // ── Command handlers ────────────────────────────────────────────

    private handleResize(payload: Buffer): void {
        try {
            const { cols, rows } = JSON.parse(payload.toString('utf-8'));
            if (typeof cols === 'number' && typeof rows === 'number') {
                if (!this.shell) {
                    this.spawnPty(cols, rows);
                } else {
                    this.shell.resize(cols, rows);
                }
            }
        } catch {
            // Invalid resize payload — ignore
        }
    }

    private handleInput(payload: Buffer): void {
        if (this.shell) {
            this.shell.write(payload.toString('binary'));
        }
    }

    private handleResume(): void {
        this.paused = false;
        for (const chunk of this.outputBuffer) {
            this.sendBinary(ServerCmd.OUTPUT, chunk);
        }
        this.outputBuffer = [];
    }

    // ── PTY management ──────────────────────────────────────────────

    private spawnPty(cols: number, rows: number): void {
        try {
            this.shell = pty.spawn('/usr/local/bin/tmux', ['new-session', '-A', '-s', 'claude-web'], {
                name: 'xterm-256color',
                cols,
                rows,
                cwd: process.env.HOME || '/Users/Camus',
                env: {
                    ...process.env,
                    TERM: 'xterm-256color',
                    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
                    PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
                } as Record<string, string>,
            });
            console.log(`[+] PTY spawned (${cols}x${rows}), pid: ${this.shell.pid}`);
        } catch (err) {
            console.error('[!] Failed to spawn PTY:', err);
            this.sendAlert('Failed to spawn terminal session.');
            this.ws.close();
            return;
        }

        this.shell.onData((data: string) => {
            if (this.ws.readyState !== WebSocket.OPEN) {
                return;
            }
            const payload = Buffer.from(data, 'binary');
            if (this.paused) {
                this.outputBuffer.push(payload);
                return;
            }
            this.sendBinary(ServerCmd.OUTPUT, payload);
        });

        this.shell.onExit(({ exitCode }) => {
            console.log(`[!] PTY exited with code ${exitCode}`);
            this.ws.close();
        });
    }

    // ── Helpers ─────────────────────────────────────────────────────

    private sendBinary(cmd: number, payload: Buffer): void {
        if (this.ws.readyState === WebSocket.OPEN) {
            const msg = Buffer.alloc(1 + payload.length);
            msg[0] = cmd;
            payload.copy(msg, 1);
            this.ws.send(msg);
        }
    }

    private sendAlert(text: string): void {
        this.sendBinary(ServerCmd.ALERT, Buffer.from(text, 'utf-8'));
    }
}

/**
 * Authenticate a terminal WebSocket connection.
 */
export function authenticateTerminalConnection(url: string, host: string, authToken: string): boolean {
    try {
        const parsed = new URL(url, `http://${host}`);
        return parsed.searchParams.get('token') === authToken;
    } catch {
        return false;
    }
}
