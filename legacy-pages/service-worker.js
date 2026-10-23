/* global self, caches, URL */
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await Promise.all((await caches.keys()).map((key) => caches.delete(key)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: "window" });
      await Promise.all(
        clients.map((client) => {
          const url = new URL(client.url);
          const path = url.pathname.replace(/^\/tasknotes-app(?=\/|$)/, "");
          return client.navigate(
            "https://app.tasknotes.dev" + path + url.search + url.hash,
          );
        }),
      );
    })(),
  );
});
