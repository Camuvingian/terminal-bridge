import { useEffect, useRef } from 'react';

/**
 * Registers a service worker and shows a browser notification when an
 * AI query completes while the page is hidden (user on another tab or
 * app minimised).
 *
 * Call `notifyIfHidden()` from the server message handler when a
 * `result` message arrives.
 */
export function useBackgroundNotifications(): {
    notifyIfHidden: (summary: string) => void;
} {
    const swReady = useRef(false);

    // Register service worker + request notification permission
    useEffect(() => {
        if (!('serviceWorker' in navigator) || !('Notification' in window)) {
            return;
        }

        (async () => {
            try {
                // Register (or re-use) the service worker
                await navigator.serviceWorker.register('/ai/sw.js', { scope: '/ai/' });
                swReady.current = true;

                // Request permission (no-op if already granted/denied)
                if (Notification.permission === 'default') {
                    await Notification.requestPermission();
                }
            } catch {
                // SW registration can fail in dev (HTTP) on some browsers
            }
        })();
    }, []);

    function notifyIfHidden(summary: string) {
        if (
            document.visibilityState !== 'hidden' ||
            Notification.permission !== 'granted' ||
            !swReady.current
        ) {
            return;
        }

        navigator.serviceWorker.ready.then((reg) => {
            reg.active?.postMessage({
                type: 'AI_QUERY_COMPLETE',
                body: summary,
            });
        });
    }

    return { notifyIfHidden };
}
