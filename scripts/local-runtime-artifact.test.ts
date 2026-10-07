/// <reference types="node" />
import { createHash, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import intake from "../vendor/mdbase-app-local-b3e605ac.json";
import { loadLocalRuntimeArtifact } from "../src/storage/local-runtime-artifact";

const bytes = Uint8Array.from(readFileSync(`vendor/${intake.wasm.file}`));
const unavailable =
  "Local runtime artifact unavailable. Preserve storage and reopen.";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function worker() {
  vi.stubGlobal("window", undefined);
  vi.stubGlobal("crypto", webcrypto);
  return vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(bytes.slice())),
  );
}

describe("dormant immutable local-runtime intake (no bootstrap/SQL/activation)", () => {
  it("pins actual SDK/storage archives and optimized WASM to exact source hashes/budgets", () => {
    for (const artifact of [intake.sdk, intake.storage, intake.wasm]) {
      const data = readFileSync(`vendor/${artifact.file}`);
      expect(createHash("sha256").update(data).digest("hex")).toBe(
        artifact.sha256,
      );
    }
    expect(bytes.length).toBe(intake.wasm.bytes);
    expect(intake.wasm.bytes).toBeLessThanOrEqual(intake.wasm.ceilings.raw);
    expect(intake.wasm.gzipBytes).toBeLessThanOrEqual(
      intake.wasm.ceilings.gzip,
    );
    expect(intake.wasm.brotliBytes).toBeLessThanOrEqual(
      intake.wasm.ceilings.brotli,
    );
    expect(intake.qualification.saved).toBe(false);
  });
  it("returns fresh integrity-checked app bytes each time, without instantiating", async () => {
    worker();
    const instantiate = vi.spyOn(WebAssembly, "instantiate");
    const a = await loadLocalRuntimeArtifact(),
      b = await loadLocalRuntimeArtifact();
    expect(a).not.toBe(b);
    expect(
      WebAssembly.Module.exports(await WebAssembly.compile(a)).map(
        (item) => item.name,
      ),
    ).toContain("rt_app_device_adopt");
    expect(instantiate).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
      }),
    );
  });
  it("refuses UI-thread use before fetching", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(loadLocalRuntimeArtifact()).rejects.toThrow(unavailable);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("refuses already cancelled acquisition before fetching", async () => {
    worker();
    await expect(loadLocalRuntimeArtifact(AbortSignal.abort())).rejects.toThrow(
      unavailable,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects a same-sized corruption without compiling or fallback", async () => {
    worker();
    const corrupt = bytes.slice();
    corrupt[123] = corrupt[123]! ^ 1;
    vi.mocked(fetch).mockResolvedValue(new Response(corrupt));
    const compile = vi.spyOn(WebAssembly, "compile");
    await expect(loadLocalRuntimeArtifact()).rejects.toThrow(unavailable);
    expect(compile).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("rejects truncated/oversized streams before compiling", async () => {
    worker();
    const compile = vi.spyOn(WebAssembly, "compile");
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(bytes.subarray(0, 8)))
      .mockResolvedValueOnce(new Response(new Uint8Array(bytes.length + 1)));
    await expect(loadLocalRuntimeArtifact()).rejects.toThrow(unavailable);
    await expect(loadLocalRuntimeArtifact()).rejects.toThrow(unavailable);
    expect(compile).not.toHaveBeenCalled();
  });
  it("rejects oversized Content-Length without reading its body", async () => {
    worker();
    const response = new Response(bytes, {
      headers: { "Content-Length": String(bytes.length + 1) },
    });
    const read = vi.spyOn(response.body!, "getReader");
    vi.mocked(fetch).mockResolvedValue(response);
    await expect(loadLocalRuntimeArtifact()).rejects.toThrow(unavailable);
    expect(read).not.toHaveBeenCalled();
  });
  it("checks cancellation after download and hides fetch exceptions", async () => {
    worker();
    const abort = new AbortController();
    vi.mocked(fetch).mockImplementationOnce(async () => {
      abort.abort();
      return new Response(bytes);
    });
    await expect(loadLocalRuntimeArtifact(abort.signal)).rejects.toThrow(
      unavailable,
    );
    vi.mocked(fetch).mockRejectedValueOnce(Error("private endpoint fixture"));
    await expect(loadLocalRuntimeArtifact()).rejects.toThrow(unavailable);
  });
  it("uses only the existing neutral storage subpath and first-party optional SDK facade", async () => {
    const storage = await import("@mdbase-dev/obsidian-runtime/app-storage");
    const host = await import("@mdbase-dev/sdk/app-host");
    expect(storage.openAppSahpoolIndex).toBeTypeOf("function");
    expect(storage.AppBinaryIndexHost).toBeTypeOf("function");
    expect(host.appLocalConnector).toBeTypeOf("function");
    expect(host.openOwnedAppWorker).toBeTypeOf("function");
  });
});
