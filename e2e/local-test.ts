import { test as base } from "@playwright/test";
export * from "@playwright/test";

/** Local suites must never fall through to a real authority or registration API.
 * Page-level relay mocks take precedence over this context-level safety net.
 */
export const test = base.extend<{ localTraffic: void }>({
  localTraffic: [
    async ({ context, baseURL }, use) => {
      if (!baseURL) throw new Error("Local browser tests require a baseURL");
      const application = new URL(baseURL);
      if (!["127.0.0.1", "localhost", "[::1]"].includes(application.hostname)) {
        throw new Error(
          "Local browser tests require a loopback application URL",
        );
      }
      await context.route("**/*", (route) => {
        const url = new URL(route.request().url());
        return url.origin === application.origin
          ? route.continue()
          : route.abort("blockedbyclient");
      });
      await context.routeWebSocket("**/*", (socket) => {
        const url = new URL(socket.url());
        if (url.host === application.host) socket.connectToServer();
        else socket.close();
      });
      await use();
    },
    { auto: true },
  ],
  serviceWorkers: "block",
});
