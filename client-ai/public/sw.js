/**
 * Terminal Bridge Service Worker
 *
 * Listens for messages from the main thread and shows notifications
 * when AI queries complete while the page is in the background.
 */

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'AI_QUERY_COMPLETE') {
        self.registration.showNotification('Terminal Bridge', {
            body: event.data.body || 'AI response ready',
            icon: '/ai/favicon.ico',
            tag: 'ai-query-complete',
            renotify: true,
        });
    }
});

// Focus the existing tab when notification is clicked
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if (client.url.includes('/ai') && 'focus' in client) {
                    return client.focus();
                }
            }
            // No existing tab found — open a new one
            return self.clients.openWindow('/ai');
        }),
    );
});
