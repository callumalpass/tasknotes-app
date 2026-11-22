// @vitest-environment-options {"url":"https://ui.example/"}
import { expect, it, vi } from "vitest";
import { directBackendOrigin } from "@tasknotes/direct-sdk/direct";
import { takePairInvitation } from "./direct-invitation";
import { directSiteAvailable } from "./direct-site";

it.each([
  "https://app.tasknotes.dev",
  "https://planner.tasknotes.dev",
  "https://calendar.tasknotes.dev",
  "https://mdbase-connect-candidate-b.onrender.com",
  "https://staging.tasknotes.dev.:443",
  "https://lab.tasknotes-app.pages.dev",
  "https://connect.mdbase.dev",
  "http://127.0.0.1",
  "https://alice@backend.test",
  "https://backend.test/#token",
  "https://backend.test/?token",
  "https://backend.test/path",
])("refuses non-backend origin %s", (value) => {
  expect(() => directBackendOrigin(value)).toThrow();
});

it("allows the explicit build on a clean HTTPS UI, including the official origin, but never takes over a previous worker", async () => {
  const getRegistrations = vi.fn().mockResolvedValue([]);
  const workers = { getRegistrations, controller: null };
  const available = () =>
    directSiteAvailable(
      new URL("https://app.tasknotes.dev") as unknown as Location,
      workers as unknown as ServiceWorkerContainer,
    );
  expect(await available()).toBe(true);
  getRegistrations.mockResolvedValue([{ waiting: {} }]);
  expect(await available()).toBe(false);
  Object.assign(workers, { controller: {} });
  getRegistrations.mockResolvedValue([]);
  expect(await available()).toBe(false);
});

it.each([
  "/#mdbase-pair=%",
  "/#mdbase-pair=",
  "/#mdbase-pair=" + encodeURIComponent("https://10.0.0.1:1980"),
  "/#mdbase-pair=" +
    encodeURIComponent("https://10.0.0.1:1980#sha256=" + "a".repeat(64)) +
    "&otp=12345678",
  "/wrong#mdbase-pair=bad",
  "/?x=1#mdbase-pair=bad",
])("scrubs and rejects malformed invitation %s", (path) => {
  history.replaceState({ stale: true }, "", path);
  expect(() => takePairInvitation()).toThrow();
  expect(location.href).toBe("https://ui.example/");
  expect(history.state).toBeNull();
});

it("accepts a browser that has no service-worker API", async () => {
  expect(await directSiteAvailable(location, undefined)).toBe(true);
});

it("fails closed when worker discovery is unavailable or a controller appears during discovery", async () => {
  expect(
    await directSiteAvailable(location, {} as ServiceWorkerContainer),
  ).toBe(false);
  const workers = {
    controller: null as object | null,
    getRegistrations: async () => {
      workers.controller = {};
      return [];
    },
  };
  expect(
    await directSiteAvailable(
      location,
      workers as unknown as ServiceWorkerContainer,
    ),
  ).toBe(false);
});
