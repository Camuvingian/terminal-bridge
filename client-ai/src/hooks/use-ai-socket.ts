import { useEffect, useRef, useCallback } from 'react';
import type { AiClientMessage, AiServerMessage } from '@shared/ai-protocol';

interface UseAiSocketOptions {
    token: string;
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
export function useAiSocket({ token, onMessage, onConnected, onReconnecting, onDisconnect, onError }: UseAiSocketOptions): AiSocket {
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectDelay = useRef(1000);
    const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const mountedRef = useRef(true);
    const intentionalClose = useRef(false);

    // Stable refs for callbacks to avoid reconnect cycles
    const onMessageRef = useRef(onMessage);
    const onConnectedRef = useRef(onConnected);
    const onReconnectingRef = useRef(onReconnecting);
    const onErrorRef = useRef(onError);

    useEffect(() => {
        onMessageRef.current = onMessage;
        onConnectedRef.current = onConnected;
        onReconnectingRef.current = onReconnecting;
        onErrorRef.current = onError;
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

        return () => {
            mountedRef.current = false;
            intentionalClose.current = true;
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
