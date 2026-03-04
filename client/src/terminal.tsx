import { useEffect, useRef, useCallback } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import { ClientCmd, ServerCmd } from '@shared/protocol';
import KeyBar from './key-bar';

interface TerminalProps {
    token: string;
    onConnected: () => void;
    onError: (msg: string) => void;
    onDisconnect: () => void;
    onReconnecting: () => void;
}

// Build a binary message: [cmd, ...payload]
function buildBinaryMessage(cmd: number, payload?: string | Uint8Array): ArrayBuffer {
    const data = typeof payload === 'string' ? new TextEncoder().encode(payload) : payload;
    const buf = new Uint8Array(1 + (data?.length ?? 0));
    buf[0] = cmd;
    if (data) {
        buf.set(data, 1);
    }
    return buf.buffer;
}

const Terminal: React.FC<TerminalProps> = ({ token, onConnected, onError, onDisconnect, onReconnecting }) => {
    const termRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<XTerm | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const fitRef = useRef<FitAddon | null>(null);
    const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const reconnectDelay = useRef(1000);
    const intentionalClose = useRef(false);
    const mountedRef = useRef(true);

    const getWsUrl = useCallback(() => {
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        return `${protocol}://${window.location.host}/ws?token=${encodeURIComponent(token)}`;
    }, [token]);

    const sendResize = useCallback((ws: WebSocket, fitAddon: FitAddon) => {
        const dims = fitAddon.proposeDimensions();
        if (dims && ws.readyState === WebSocket.OPEN) {
            const json = JSON.stringify({ cols: dims.cols, rows: dims.rows });
            ws.send(buildBinaryMessage(ClientCmd.RESIZE, json));
        }
    }, []);

    // Send raw bytes to the WebSocket (used by KeyBar)
    const sendInput = useCallback((data: string) => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
            const encoder = new TextEncoder();
            ws.send(buildBinaryMessage(ClientCmd.INPUT, encoder.encode(data)));
        }
    }, []);

    useEffect(() => {
        if (!termRef.current) {
            return;
        }

        mountedRef.current = true;
        intentionalClose.current = false;

        // 1. Create xterm.js instance
        const term = new XTerm({
            cursorBlink: true,
            cursorStyle: 'block',
            fontSize: 14,
            fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", monospace',
            theme: {
                background: '#0d1117',
                foreground: '#e6edf3',
                cursor: '#58a6ff',
                selectionBackground: '#264f78',
                black: '#484f58',
                red: '#ff7b72',
                green: '#7ee787',
                yellow: '#d29922',
                blue: '#58a6ff',
                magenta: '#bc8cff',
                cyan: '#76e3ea',
                white: '#e6edf3',
            },
            allowProposedApi: true,
            scrollback: 10000,
        });

        const fitAddon = new FitAddon();
        const webLinksAddon = new WebLinksAddon();

        term.loadAddon(fitAddon);
        term.loadAddon(webLinksAddon);
        term.open(termRef.current);

        // Try WebGL renderer for performance (falls back to canvas)
        try {
            term.loadAddon(new WebglAddon());
        } catch {
            console.log('WebGL not available, using canvas renderer');
        }

        fitAddon.fit();
        xtermRef.current = term;
        fitRef.current = fitAddon;

        // 2. Connect WebSocket with reconnect support
        function connect() {
            if (!mountedRef.current) {
                return;
            }

            const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
            const wsUrl = `${protocol}://${window.location.host}/ws?token=${encodeURIComponent(token)}`;
            const ws = new WebSocket(wsUrl);
            ws.binaryType = 'arraybuffer';
            wsRef.current = ws;

            ws.onopen = () => {
                reconnectDelay.current = 1000; // Reset backoff
                onConnected();
                term.focus();
                sendResize(ws, fitAddon);
            };

            // Server → browser: binary frames
            ws.onmessage = (event: MessageEvent) => {
                if (!(event.data instanceof ArrayBuffer)) {
                    return;
                }

                const view = new Uint8Array(event.data);
                if (view.length === 0) {
                    return;
                }

                const cmd = view[0];
                const payload = view.slice(1);

                switch (cmd) {
                    case ServerCmd.OUTPUT:
                        term.write(payload);
                        break;
                    case ServerCmd.TITLE:
                        document.title = new TextDecoder().decode(payload);
                        break;
                    case ServerCmd.ALERT:
                        term.write(`\r\n\x1b[33m[Server] ${new TextDecoder().decode(payload)}\x1b[0m\r\n`);
                        break;
                }
            };

            ws.onerror = () => {
                // onerror is always followed by onclose, handle reconnect there
            };

            ws.onclose = () => {
                if (!mountedRef.current || intentionalClose.current) {
                    return;
                }

                // Auto-reconnect with exponential backoff
                onReconnecting();
                term.write(`\r\n\x1b[33m[Reconnecting in ${reconnectDelay.current / 1000}s...]\x1b[0m\r\n`);

                reconnectTimer.current = setTimeout(() => {
                    reconnectDelay.current = Math.min(reconnectDelay.current * 2, 30000);
                    connect();
                }, reconnectDelay.current);
            };
        }

        connect();

        // ── Visibility-based instant reconnect ─────────────────────
        function onVisibilityChange() {
            if (document.visibilityState !== 'visible' || !mountedRef.current || intentionalClose.current) {
                return;
            }
            const ws = wsRef.current;
            if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
                if (reconnectTimer.current) {
                    clearTimeout(reconnectTimer.current);
                    reconnectTimer.current = null;
                }
                reconnectDelay.current = 1000;
                connect();
            }
        }
        document.addEventListener('visibilitychange', onVisibilityChange);

        // 3. Browser → server: keystrokes
        const dataDisposable = term.onData((data: string) => {
            const ws = wsRef.current;
            if (ws && ws.readyState === WebSocket.OPEN) {
                const encoder = new TextEncoder();
                ws.send(buildBinaryMessage(ClientCmd.INPUT, encoder.encode(data)));
            }
        });

        // 4. Handle terminal resize
        const handleResize = () => {
            fitAddon.fit();
            const ws = wsRef.current;
            if (ws) {
                sendResize(ws, fitAddon);
            }
        };

        window.addEventListener('resize', handleResize);
        window.addEventListener('orientationchange', () => {
            setTimeout(handleResize, 200);
        });

        // 5. Cleanup
        return () => {
            mountedRef.current = false;
            intentionalClose.current = true;
            document.removeEventListener('visibilitychange', onVisibilityChange);
            window.removeEventListener('resize', handleResize);
            if (reconnectTimer.current) {
                clearTimeout(reconnectTimer.current);
            }
            dataDisposable.dispose();
            wsRef.current?.close();
            term.dispose();
        };
    }, [token, onConnected, onError, onDisconnect, onReconnecting, getWsUrl, sendResize]);

    return (
        <>
            <div ref={termRef} className="terminal-viewport" />
            <KeyBar onSend={sendInput} />
        </>
    );
};

export default Terminal;
