// Prism's service worker: it shows the notifications Prism sends this device,
// and opens Prism where one points when it's tapped. Nothing else: it caches
// nothing and sees no page requests, so it can never serve money figures
// from an old visit.
//
// A message arrives encrypted for this device (the browser decrypts it before
// this runs) as { title, body, url }, where url is a path on Prism.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

/** Only ever a path on Prism: never another site, whatever a message says. */
function pathOnPrism(url) {
  if (typeof url !== "string" || !url.startsWith("/") || url.startsWith("//")) return "/";
  try {
    const target = new URL(url, self.location.origin);
    return target.origin === self.location.origin ? target.pathname + target.search + target.hash : "/";
  } catch {
    return "/";
  }
}

self.addEventListener("push", (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    message = {};
  }
  const title = typeof message.title === "string" && message.title ? message.title.slice(0, 120) : "Prism";
  const body = typeof message.body === "string" ? message.body.slice(0, 240) : "";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      tag: "prism-alerts",
      renotify: true,
      data: { url: pathOnPrism(message.url) },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = pathOnPrism(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of open) {
        if (new URL(client.url).origin === self.location.origin && "focus" in client) {
          await client.focus();
          if ("navigate" in client) await client.navigate(path).catch(() => undefined);
          return;
        }
      }
      await self.clients.openWindow(path);
    })(),
  );
});
