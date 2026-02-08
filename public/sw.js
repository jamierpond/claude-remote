// Service Worker for Claude Remote PWA push notifications

self.addEventListener("push", (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();
    const options = {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: data.url || "/" },
      tag: "claude-remote",
      renotify: true,
    };

    event.waitUntil(
      self.registration.showNotification(
        data.title || "Claude Remote",
        options,
      ),
    );
  } catch (err) {
    console.error("[sw] Push event error:", err);
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = event.notification.data?.url || "/";

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        // Focus existing window if open
        for (const client of windowClients) {
          if (client.url.includes(self.location.origin) && "focus" in client) {
            return client.focus();
          }
        }
        // Otherwise open a new window
        return clients.openWindow(url);
      }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(clients.claim());
});
