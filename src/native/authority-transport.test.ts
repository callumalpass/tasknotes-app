import { AUTHORITY_PROOF_HEADERS } from "@mdbase-dev/connect-protocol";
import { beforeEach, afterEach, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({
  native: false,
  name: "web",
  request: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => platform.native,
    getPlatform: () => platform.name,
  },
  registerPlugin: () => ({
    request: platform.request,
    cancel: platform.cancel,
  }),
}));

import {
  createNativeAuthorityFetch,
  installNativeAuthorityTransport,
} from "./authority-transport";

const url =
  "https://provider.example/v1/authorities/00000000-0000-0000-0000-000000000042/operations/describe";
const headers: Record<string, string> = {
  authorization: "Bearer fixture-capability",
  ...Object.fromEntries(
    Object.values(AUTHORITY_PROOF_HEADERS).map((name) => [
      name,
      "fixture-proof",
    ]),
  ),
};
let browserFetch: ReturnType<typeof vi.fn<typeof fetch>>;
let nativeFetch: typeof fetch;

function base64(value: string | Uint8Array): string {
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
}

function bytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

beforeEach(() => {
  platform.native = false;
  platform.name = "web";
  platform.request.mockReset().mockResolvedValue({
    url,
    status: 200,
    headers: { "content-type": "application/json" },
    body: base64('{"ok":true}'),
  });
  platform.cancel.mockReset().mockResolvedValue(undefined);
  browserFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response("web"));
  nativeFetch = createNativeAuthorityFetch(browserFetch, {
    request: platform.request,
    cancel: platform.cancel,
  });
});
afterEach(() => vi.unstubAllGlobals());

it("sends only signed authority traffic to the native bridge, without changing proof or UTF-8 body bytes", async () => {
  const body = JSON.stringify({ title: "Réunion 📝" });
  const response = await nativeFetch(url, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body,
  });
  expect(await response.json()).toEqual({ ok: true });
  expect(response.url).toBe(url);
  const request = platform.request.mock.calls[0]![0];
  expect(request.url).toBe(url);
  expect(request.method).toBe("POST");
  expect(request.headers).toEqual({
    ...headers,
    "content-type": "application/json",
  });
  expect(new TextDecoder().decode(bytes(request.body))).toBe(body);
  expect(browserFetch).not.toHaveBeenCalled();
});

it.each([
  "https://connect.example/oauth/token",
  "https://provider.example/unrelated",
  "http://127.0.0.1:28485/v1/authorities/00000000-0000-0000-0000-000000000042/operations/describe",
  "capacitor://app.tasknotes.dev/assets/app.js",
])("keeps non-authority traffic on the original fetch: %s", async (target) => {
  await nativeFetch(target, { headers });
  expect(browserFetch).toHaveBeenCalledOnce();
  expect(platform.request).not.toHaveBeenCalled();
});

it("keeps unsigned and incomplete-proof requests on browser fetch", async () => {
  await nativeFetch(url);
  await nativeFetch(url, { headers: { authorization: headers.authorization } });
  const incomplete = { ...headers };
  delete incomplete[AUTHORITY_PROOF_HEADERS.signature];
  await nativeFetch(url, { headers: incomplete });
  expect(browserFetch).toHaveBeenCalledTimes(3);
  expect(platform.request).not.toHaveBeenCalled();
});

it("does not consume a Request body before browser fallback", async () => {
  const input = new Request("https://connect.example/oauth/token", {
    method: "POST",
    body: "exact-form-bytes",
  });
  browserFetch.mockImplementationOnce(async (request) => {
    expect(await (request as Request).text()).toBe("exact-form-bytes");
    return new Response("ok");
  });
  await nativeFetch(input);
});

it("preserves binary request and response bytes, including large bridge bodies", async () => {
  const bytes = Uint8Array.from({ length: 70_000 }, (_, index) => index % 256);
  platform.request.mockResolvedValueOnce({
    url,
    status: 200,
    headers: { "content-type": "application/octet-stream" },
    body: base64(bytes),
  });
  const response = await nativeFetch(url, {
    method: "PUT",
    headers,
    body: bytes,
  });
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  expect(
    Uint8Array.from(
      atob(platform.request.mock.calls[0]![0].body),
      (character) => character.charCodeAt(0),
    ),
  ).toEqual(bytes);
});

it("returns authority denials unchanged rather than retrying or bypassing them", async () => {
  platform.request.mockResolvedValueOnce({
    url,
    status: 403,
    headers: { "content-type": "application/json" },
    body: base64('{"error":{"code":"origin_denied"}}'),
  });
  const response = await nativeFetch(url, { headers });
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: { code: "origin_denied" } });
  expect(platform.request).toHaveBeenCalledOnce();
  expect(browserFetch).not.toHaveBeenCalled();
});

it.each([301, 302, 303, 307, 308])(
  "rejects redirects without forwarding or retrying credentials: %s",
  async (status) => {
    platform.request.mockResolvedValueOnce({
      url,
      status,
      headers: { location: "https://other.example" },
      body: "",
    });
    await expect(nativeFetch(url, { headers })).rejects.toThrow(/redirects/);
    expect(platform.request).toHaveBeenCalledOnce();
    expect(browserFetch).not.toHaveBeenCalled();
  },
);

it("rejects a response from another target", async () => {
  platform.request.mockResolvedValueOnce({
    url: url + "/other",
    status: 200,
    headers: {},
    body: "",
  });
  await expect(nativeFetch(url, { headers })).rejects.toThrow(/redirects/);
});

it("rejects cookie-bearing authority requests before dispatch", async () => {
  await expect(
    nativeFetch(url, { headers, credentials: "include" }),
  ).rejects.toThrow(/cookies/);
  expect(platform.request).not.toHaveBeenCalled();
});

it("supports WebKit without throwIfAborted or custom abort reasons", async () => {
  const prototype = Object.getPrototypeOf(new Request(url).signal);
  const method = Object.getOwnPropertyDescriptor(prototype, "throwIfAborted")!;
  const reason = Object.getOwnPropertyDescriptor(prototype, "reason")!;
  Object.defineProperty(prototype, "throwIfAborted", {
    configurable: true,
    value: undefined,
  });
  Object.defineProperty(prototype, "reason", {
    configurable: true,
    get: () => undefined,
  });
  try {
    expect((await nativeFetch(url, { headers })).status).toBe(200);
    const controller = new AbortController();
    controller.abort();
    await expect(
      nativeFetch(url, { headers, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(platform.request).toHaveBeenCalledOnce();
  } finally {
    Object.defineProperty(prototype, "throwIfAborted", method);
    Object.defineProperty(prototype, "reason", reason);
  }
});

it("does not send an already-aborted request", async () => {
  const controller = new AbortController();
  const reason = new Error("budget expired");
  controller.abort(reason);
  await expect(
    nativeFetch(url, { headers, signal: controller.signal }),
  ).rejects.toBe(reason);
  expect(platform.request).not.toHaveBeenCalled();
});

it("aborts the native task with the caller's original reason and ignores late completion", async () => {
  let complete!: (value: unknown) => void;
  platform.request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const controller = new AbortController();
  const operation = nativeFetch(url, { headers, signal: controller.signal });
  const reason = new Error("TaskNotes request budget expired");
  controller.abort(reason);
  await expect(operation).rejects.toBe(reason);
  expect(platform.cancel).toHaveBeenCalledWith({
    id: platform.request.mock.calls[0]![0].id,
  });
  complete({ url, status: 200, headers: {}, body: "" });
});

it("cleans up abort listeners after completion", async () => {
  const controller = new AbortController();
  await nativeFetch(url, { headers, signal: controller.signal });
  controller.abort();
  expect(platform.cancel).not.toHaveBeenCalled();
});

it.each([204, 205, 304])("supports bodyless responses: %s", async (status) => {
  platform.request.mockResolvedValueOnce({
    url,
    status,
    headers: {},
    body: "",
  });
  expect((await nativeFetch(url, { headers })).body).toBeNull();
});

it("propagates bridge failures without an unsafe browser fallback", async () => {
  platform.request.mockRejectedValueOnce(
    new Error("native network unavailable"),
  );
  await expect(nativeFetch(url, { headers })).rejects.toThrow(/unavailable/);
  expect(browserFetch).not.toHaveBeenCalled();
});

it.each(["web", "android"])("does not replace fetch on %s", (name) => {
  platform.name = name;
  platform.native = name !== "web";
  vi.stubGlobal("fetch", browserFetch);
  installNativeAuthorityTransport();
  expect(window.fetch).toBe(browserFetch);
});

it("installs the proof-scoped adapter only on native iOS", async () => {
  platform.name = "ios";
  platform.native = true;
  vi.stubGlobal("fetch", browserFetch);
  installNativeAuthorityTransport();
  await window.fetch(url, { headers });
  expect(platform.request).toHaveBeenCalledOnce();
  expect(browserFetch).not.toHaveBeenCalled();
});
