import { afterEach, beforeEach, expect, it, vi } from "vitest";

const scope = "https://app.tasknotes.dev/";
const oldCacheName = "tasknotes-app-shell-v1";
const currentCacheName = "tasknotes-app-shell-v2";
const key = (request: RequestInfo | URL) =>
  typeof request === "string"
    ? new URL(request, scope).href
    : request instanceof URL
      ? request.href
      : request.url;

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

async function fixture() {
  const handlers = new Map<string, (event: unknown) => void>();
  const entries = new Map([
    [oldCacheName, new Map<string, Response>()],
    [currentCacheName, new Map<string, Response>()],
  ]);
  const storage = {
    keys: vi.fn(async () => [...entries.keys()]),
    delete: vi.fn(async (name: string) => entries.delete(name)),
    open: vi.fn(async (name: string) => {
      let cache = entries.get(name);
      if (!cache) {
        cache = new Map();
        entries.set(name, cache);
      }
      const target = cache;
      return {
        match: vi.fn(async (request: RequestInfo | URL) =>
          target.get(key(request))?.clone(),
        ),
        put: vi.fn(async (request: RequestInfo | URL, response: Response) => {
          target.set(key(request), response);
        }),
        addAll: vi.fn(async () => undefined),
      };
    }),
  };
  const hidden = { url: scope, visibilityState: "hidden", navigate: vi.fn() };
  const visible = { url: scope, visibilityState: "visible", navigate: vi.fn() };
  const clients = {
    claim: vi.fn(async () => undefined),
    matchAll: vi.fn(async () => [hidden, visible]),
  };
  vi.stubGlobal("self", {
    location: new URL(scope),
    registration: { scope },
    clients,
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      handlers.set(type, listener);
    },
  });
  vi.stubGlobal("caches", storage);
  const fetch = vi.fn(async (): Promise<Response> => {
    throw new Error("Offline");
  });
  vi.stubGlobal("fetch", fetch);
  await import("./service-worker");

  async function activate() {
    let settled: Promise<unknown> | undefined;
    handlers.get("activate")!({
      waitUntil: (promise: Promise<unknown>) => {
        settled = promise;
      },
    });
    await settled;
  }
  async function request(path: string, navigation = false) {
    const request = new Request(new URL(path, scope));
    if (navigation)
      Object.defineProperty(request, "mode", { value: "navigate" });
    let response: Promise<Response> | undefined;
    handlers.get("fetch")!({
      request,
      respondWith: (promise: Promise<Response>) => {
        response = promise;
      },
    });
    expect(response).toBeDefined();
    return response!;
  }
  return {
    entries,
    storage,
    clients,
    hidden,
    visible,
    fetch,
    activate,
    request,
  };
}

it("keeps old hashed chunks available after activation without navigating any tab", async () => {
  const f = await fixture();
  f.entries
    .get(oldCacheName)!
    .set(
      new URL("assets/old-lazy-HASH.js", scope).href,
      new Response("old lazy chunk"),
    );
  await f.activate();
  expect(f.clients.claim).toHaveBeenCalledOnce();
  expect(f.storage.delete).not.toHaveBeenCalled();
  expect(f.hidden.navigate).not.toHaveBeenCalled();
  expect(f.visible.navigate).not.toHaveBeenCalled();
  const response = await f.request("assets/old-lazy-HASH.js");
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("old lazy chunk");
  expect(f.fetch).not.toHaveBeenCalled();
});

it("prefers the current cached shell over a retained old shell when offline", async () => {
  const f = await fixture();
  f.entries.get(oldCacheName)!.set(scope, new Response("old shell"));
  f.entries.get(currentCacheName)!.set(scope, new Response("current shell"));
  await f.activate();
  const response = await f.request("tasks/example", true);
  expect(await response.text()).toBe("current shell");
});

it("falls back to the network for a chunk not held in either precache", async () => {
  const f = await fixture();
  f.fetch.mockResolvedValueOnce(new Response("network chunk"));
  await f.activate();
  const response = await f.request("assets/unknown-HASH.js");
  expect(await response.text()).toBe("network chunk");
  expect(f.fetch).toHaveBeenCalledOnce();
});
