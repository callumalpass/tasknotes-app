import { initializeModelPackCore } from "./next-model-pack-core";
import pin from "../../vendor/mdbase-browser.pin.json";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), init: vi.fn() }));
vi.mock("mdbase", () => ({ init: mocks.init }));
vi.mock("mdbase/wasm/mdbase-core.wasm?url", () => ({
  default: "/assets/pinned-core.wasm",
}));
vi.mock("./next-bundled-asset", () => ({ fetchBundledAsset: mocks.fetch }));
const bytes = new Uint8Array([0, 97, 115, 109]);
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetModules();
  mocks.fetch.mockReset().mockResolvedValue(bytes);
  mocks.init.mockReset().mockResolvedValue(undefined);
});
const fresh = async () =>
  (await import("./next-model-pack-core")).initializeModelPackCore;

it("uses the existing bounded pinned loader then explicitly initializes bytes once", async () => {
  const initialize = await fresh(),
    owner = signal();
  await initialize(owner);
  expect(mocks.fetch).toHaveBeenCalledWith(
    "/assets/pinned-core.wasm",
    pin.wasmSha256,
    pin.wasmBytes,
    owner,
  );
  expect(mocks.init).toHaveBeenCalledWith({ wasm: bytes });
  await initialize(signal());
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  expect(mocks.init).toHaveBeenCalledTimes(1);
});
it("refuses an already aborted owner without fetching or initializing", async () => {
  const initialize = await fresh(),
    owner = new AbortController();
  owner.abort();
  await expect(initialize(owner.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(mocks.init).not.toHaveBeenCalled();
});
it("never falls back or automatically retries a failed pinned fetch", async () => {
  const initialize = await fresh();
  mocks.fetch.mockRejectedValueOnce(new Error("Integrity refused"));
  await expect(initialize(signal())).rejects.toThrow("Integrity refused");
  expect(mocks.init).not.toHaveBeenCalled();
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  await initialize(signal()); // Fresh explicit request, same pinned binding.
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
  expect(mocks.fetch.mock.calls[1]!.slice(0, 3)).toEqual([
    "/assets/pinned-core.wasm",
    pin.wasmSha256,
    pin.wasmBytes,
  ]);
  expect(mocks.init).toHaveBeenCalledTimes(1);
});
it("refuses abort during the asset await before invoking the package", async () => {
  const initialize = await fresh(),
    owner = new AbortController();
  let release!: (value: Uint8Array) => void;
  mocks.fetch.mockReturnValueOnce(
    new Promise<Uint8Array>((resolve) => {
      release = resolve;
    }),
  );
  const pending = initialize(owner.signal);
  owner.abort();
  release(bytes);
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(mocks.init).not.toHaveBeenCalled();
});
it("shares one pinned initialization while independently refusing an aborted waiter", async () => {
  const initialize = await fresh(),
    waiter = new AbortController();
  let release!: (value: Uint8Array) => void;
  mocks.fetch.mockReturnValueOnce(
    new Promise<Uint8Array>((resolve) => {
      release = resolve;
    }),
  );
  const original = initialize(signal()),
    waiting = initialize(waiter.signal);
  waiter.abort();
  release(bytes);
  await original;
  await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
  await initialize(signal());
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  expect(mocks.init).toHaveBeenCalledTimes(1);
});
it("retains refusal of invalid module bytes without a substitute loader", async () => {
  const initialize = await fresh();
  mocks.init.mockRejectedValueOnce(new Error("Module refused"));
  await expect(initialize(signal())).rejects.toThrow("Module refused");
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  expect(mocks.init).toHaveBeenCalledTimes(1);
});
// Export typing remains the promised initializer seam, never a held client.
const signature: (owner: AbortSignal) => Promise<void> =
  initializeModelPackCore;
void signature;
