import { useEffect, useRef, useCallback } from 'react';
import type { AiClientMessage, AiServerMessage } from '@shared/ai-protocol';

const LAST_SEQ_KEY = 'terminal-bridge-last-seq';
const HEARTBEAT_STALE_MS = 45_000;
const REPLAY_IDLE_GAP_MS = 200;

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

/** Save lastSeq to sessionStorage. */
function saveLastSeq(seq: number): void {
    try {
        sessionStorage.setItem(LAST_SEQ_KEY, String(seq));
    } catch { /* ignore */ }
}

/** Load lastSeq from sessionStorage. */
function loadLastSeq(): number {
    try {
        const raw = sessionStorage.getItem(LAST_SEQ_KEY);
        return raw ? parseInt(raw, 10) || 0 : 0;
    } catch {
        return 0;
    }
}

/** Clear lastSeq from sessionStorage. */
export function clearLastSeq(): void {
    try {
        sessionStorage.removeItem(LAST_SEQ_KEY);
    } catch { /* ignore */ }
}

/**
 * WebSocket hook for the AI endpoint.
 *
 * Same exponential backoff pattern as the terminal client, but uses
 * JSON text frames instead of binary. Includes heartbeat staleness
 * detection and animated replay on reconnect.
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

    // Sequence tracking
    const lastReceivedSeq = useRef(loadLastSeq());

    // Heartbeat staleness
    const lastMessageTime = useRef(Date.now());
    const heartbeatCheckInterval = useRef<ReturnType<typeof setInterval> | null>(null);

    // Animated replay state
    const replayingRef = useRef(false);
    const replayQueueRef = useRef<AiServerMessage[]>([]);
    const replayIdleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const replayRafRef = useRef<number | null>(null);

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

        function drainReplayQueue() {
            if (replayQueueRef.current.length === 0) {
                replayingRef.current = false;
                return;
            }

            // Dispatch a batch of messages per frame
            const batch = replayQueueRef.current.splice(0, 5);
            for (const msg of batch) {
                onMessageRef.current(msg);
            }

            if (replayQueueRef.current.length > 0) {
                replayRafRef.current = requestAnimationFrame(drainReplayQueue);
            } else {
                replayingRef.current = false;
                replayRafRef.current = null;
            }
        }

        function handleIncomingMessage(msg: AiServerMessage) {
            lastMessageTime.current = Date.now();

            // Track sequence numbers
            if (msg.seq !== undefined) {
                lastReceivedSeq.current = msg.seq;
                saveLastSeq(msg.seq);
            }

            // Heartbeat — update timestamp only, skip dispatch
            if (msg.type === 'heartbeat') {
                return;
            }

            // Reset seq on init (new session)
            if (msg.type === 'init') {
                lastReceivedSeq.current = 0;
                saveLastSeq(0);
            }

            // During replay, queue messages for animated dispatch
            if (replayingRef.current) {
                replayQueueRef.current.push(msg);

                // Reset idle timer — when messages stop arriving for
                // REPLAY_IDLE_GAP_MS, end replay mode
                if (replayIdleTimer.current) {
                    clearTimeout(replayIdleTimer.current);
                }
                replayIdleTimer.current = setTimeout(() => {
                    // All messages received, start draining
                    if (replayRafRef.current === null) {
                        replayRafRef.current = requestAnimationFrame(drainReplayQueue);
                    }
                }, REPLAY_IDLE_GAP_MS);
                return;
            }

            onMessageRef.current(msg);
        }

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
                lastMessageTime.current = Date.now();
                onConnectedRef.current();

                // If we have an active session, send a reconnect message
                // with lastSeq for incremental replay
                if (sessionIdRef.current) {
                    const lastSeq = lastReceivedSeq.current;
                    replayingRef.current = lastSeq > 0;
                    ws.send(JSON.stringify({
                        type: 'reconnect',
                        sessionId: sessionIdRef.current,
                        lastSeq: lastSeq > 0 ? lastSeq : undefined,
                    }));
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

                    handleIncomingMessage(msg);
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

        // ── Heartbeat staleness check ───────────────────────────────
        heartbeatCheckInterval.current = setInterval(() => {
            const ws = wsRef.current;
            if (!ws || ws.readyState !== WebSocket.OPEN) {
                return;
            }

            if (Date.now() - lastMessageTime.current > HEARTBEAT_STALE_MS) {
                console.log('[~] Heartbeat stale, forcing reconnect');
                ws.close();
            }
        }, 10_000);

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
            if (heartbeatCheckInterval.current) {
                clearInterval(heartbeatCheckInterval.current);
            }
            if (replayIdleTimer.current) {
                clearTimeout(replayIdleTimer.current);
            }
            if (replayRafRef.current !== null) {
                cancelAnimationFrame(replayRafRef.current);
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
