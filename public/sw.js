/* Service Worker — handle Web Push notifications cho SV */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Hoạt động mới", body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "Có hoạt động mới";
  const options = {
    body: payload.body || "Giảng viên vừa kích hoạt một hoạt động.",
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    tag: payload.tag || "activity-alert",
    renotify: true,
    requireInteraction: false,
    vibrate: [200, 100, 200],
    data: { url: payload.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // Nếu có tab đang mở cùng URL → focus
      for (const client of clientList) {
        if (client.url.endsWith(targetUrl) && "focus" in client) {
          return client.focus();
        }
      }
      // Nếu có tab cùng origin → focus + navigate
      for (const client of clientList) {
        if ("focus" in client && "navigate" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      // Không có tab → mở mới
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
