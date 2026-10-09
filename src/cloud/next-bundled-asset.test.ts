import { fetchBundledAsset } from "./next-bundled-asset";
const hash = "4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a";
afterEach(() => vi.restoreAllMocks());
describe("bounded same-origin artifact integrity (transport stand-ins)", () => {
  it("loads only pinned bytes without cookies or redirects", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(Uint8Array.of(1)));
    const signal = new AbortController().signal;
    expect(
      await fetchBundledAsset("/assets/fixed.wasm", hash, 1, signal),
    ).toEqual(Uint8Array.of(1));
    expect(fetch).toHaveBeenCalledWith(
      new URL("/assets/fixed.wasm", location.href).href,
      { signal, credentials: "omit", redirect: "error" },
    );
  });
  it.each([
    "https://another-origin.invalid/fixed.wasm",
    "/fixed.wasm?capability=forbidden",
    "/fixed.wasm#change",
  ])("rejects an unbound destination %s before fetch", async (url) => {
    const fetch = vi.spyOn(globalThis, "fetch");
    await expect(
      fetchBundledAsset(url, hash, 1, new AbortController().signal),
    ).rejects.toThrow("binding");
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([Uint8Array.of(1, 2), Uint8Array.of(2), new Uint8Array()])(
    "rejects oversized, altered or empty bytes",
    async (bytes) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(bytes));
      await expect(
        fetchBundledAsset("/fixed.wasm", hash, 1, new AbortController().signal),
      ).rejects.toThrow();
    },
  );
  it("refuses cancellation before a request", async () => {
    const owner = new AbortController();
    owner.abort();
    const fetch = vi.spyOn(globalThis, "fetch");
    await expect(
      fetchBundledAsset("/fixed.wasm", hash, 1, owner.signal),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
