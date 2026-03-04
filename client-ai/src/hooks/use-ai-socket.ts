import { useEffect, useRef, useCallback } from 'react';
import type { AiClientMessage, AiServerMessage } from '@shared/ai-protocol';

interface UseAiSocketOptions {
    token: string;
    sessionId: string | null;
    onMessage: (msg: AiServerMessage) => void;
    onConnected: () => void;
    onReconnecting: () => void;
    onDisconnect: () => void;
    onError: (msg: string) => void;
}

export interface AiSocket {
    send: (msg: AiClientMessage) => void;
    close: () => void;
}

/**
 * WebSocket hook for the AI endpoint.
 *
 * Same exponential backoff pattern as the terminal client, but uses
 * JSON text frames instead of binary.
 */
export function useAiSocket({ token, sessionId, onMessage, onConnected, onReconnecting, onDisconnect, onError }: UseAiSocketOptions): AiSocket {
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectDelay = useRef(1000);
    const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const mountedRef = useRef(true);
    const intentionalClose = useRef(false);

    // Stable refs for callbacks and sessionId to avoid reconnect cycles
    const onMessageRef = useRef(onMessage);
    const onConnectedRef = useRef(onConnected);
    const onReconnectingRef = useRef(onReconnecting);
    const onErrorRef = useRef(onError);
    const sessionIdRef = useRef(sessionId);

    useEffect(() => {
        onMessageRef.current = onMessage;
        onConnectedRef.current = onConnected;
        onReconnectingRef.current = onReconnecting;
        onErrorRef.current = onError;
        sessionIdRef.current = sessionId;
    });

    useEffect(() => {
        mountedRef.current = true;
        intentionalClose.current = false;

        function connect() {
            if (!mountedRef.current) {
                return;
            }

            const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
            const wsUrl = `${protocol}://${window.location.host}/ws-ai?token=${encodeURIComponent(token)}`;
            const ws = new WebSocket(wsUrl);
            wsRef.current = ws;

            ws.onopen = () => {
                reconnectDelay.current = 1000;
                onConnectedRef.current();

                // If we have an active session, send a reconnect message
                // so the server replays the snapshot
                if (sessionIdRef.current) {
                    ws.send(JSON.stringify({ type: 'reconnect', sessionId: sessionIdRef.current }));
                }
            };

            ws.onmessage = (event: MessageEvent) => {
                if (typeof event.data !== 'string') {
                    return;
                }
                try {
                    const msg = JSON.parse(event.data) as AiServerMessage;

                    // Check for auth error
                    if (msg.type === 'error' && msg.message === 'Authentication failed.') {
                        intentionalClose.current = true;
                        ws.close();
                        onErrorRef.current('Authentication failed.');
                        return;
                    }

                    onMessageRef.current(msg);
                } catch {
                    // Invalid JSON — ignore
                }
            };

            ws.onerror = () => {
                // onerror is always followed by onclose
            };

            ws.onclose = () => {
                if (!mountedRef.current || intentionalClose.current) {
                    return;
                }

                onReconnectingRef.current();

                reconnectTimer.current = setTimeout(() => {
                    reconnectDelay.current = Math.min(reconnectDelay.current * 2, 30000);
                    connect();
                }, reconnectDelay.current);
            };
        }

        connect();

        // ── Visibility-based instant reconnect ─────────────────────
        // When the user returns to the tab (e.g., after mobile minimize),
        // force an immediate reconnect if the socket is dead, instead of
        // waiting for the next exponential backoff tick.
        function onVisibilityChange() {
            if (document.visibilityState !== 'visible' || !mountedRef.current || intentionalClose.current) {
                return;
            }

            const ws = wsRef.current;
            if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
                // Cancel any pending backoff timer and reconnect now
                if (reconnectTimer.current) {
                    clearTimeout(reconnectTimer.current);
                    reconnectTimer.current = null;
                }
                reconnectDelay.current = 1000; // reset backoff
                connect();
            }
        }

        document.addEventListener('visibilitychange', onVisibilityChange);

        return () => {
            mountedRef.current = false;
            intentionalClose.current = true;
            document.removeEventListener('visibilitychange', onVisibilityChange);
            if (reconnectTimer.current) {
                clearTimeout(reconnectTimer.current);
            }
            if (wsRef.current) {
                wsRef.current.close();
            }
        };
    }, [token]);

    const send = useCallback((msg: AiClientMessage) => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(msg));
        }
    }, []);

    const close = useCallback(() => {
        intentionalClose.current = true;
        if (reconnectTimer.current) {
            clearTimeout(reconnectTimer.current);
        }
        if (wsRef.current) {
            wsRef.current.close();
        }
        onDisconnect();
    }, [onDisconnect]);

    return { send, close };
}
