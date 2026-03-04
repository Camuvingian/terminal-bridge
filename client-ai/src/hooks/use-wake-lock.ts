import { useEffect, useRef } from 'react';

/**
 * Request a screen Wake Lock while `active` is true.
 *
 * Prevents the device from dimming/locking the screen, which on mobile
 * also prevents the browser from freezing WebSocket connections.
 *
 * The lock is automatically released when the document becomes hidden
 * (browser behaviour) and re-acquired when it becomes visible again
 * — but only if `active` is still true.
 */
export function useWakeLock(active: boolean): void {
    const lockRef = useRef<WakeLockSentinel | null>(null);

    useEffect(() => {
        if (!('wakeLock' in navigator)) {
            return;
        }

        async function acquire() {
            if (lockRef.current) {
                return; // already held
            }
            try {
                lockRef.current = await navigator.wakeLock.request('screen');
                lockRef.current.addEventListener('release', () => {
                    lockRef.current = null;
                });
            } catch {
                // Wake lock request can fail (e.g., low battery mode)
            }
        }

        async function release() {
            if (lockRef.current) {
                try {
                    await lockRef.current.release();
                } catch {
                    // Already released
                }
                lockRef.current = null;
            }
        }

        // Re-acquire on visibility change (browser releases it when hidden)
        function onVisibilityChange() {
            if (document.visibilityState === 'visible' && active) {
                acquire();
            }
        }

        if (active) {
            acquire();
            document.addEventListener('visibilitychange', onVisibilityChange);
        }

        return () => {
            document.removeEventListener('visibilitychange', onVisibilityChange);
            release();
        };
    }, [active]);
}
