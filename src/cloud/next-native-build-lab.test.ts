import { afterEach, expect, it, vi } from "vitest";
import { loadLabNativeBuild } from "./next-native-build-lab";
import { fetchBundledAsset } from "./next-bundled-asset";
vi.mock("./next-bundled-asset", () => ({
  fetchBundledAsset: vi.fn(async () => Uint8Array.of(1)),
}));
afterEach(() => vi.unstubAllGlobals());
// Source/bundle composition only; no sign-in, native runtime or LAB operation.
it("supplies the exact registered application from the fixed isolated LAB build", async () => {
  vi.stubGlobal("location", { origin: "http://127.0.0.1:48218" });
  const signal = new AbortController().signal;
  const build = await loadLabNativeBuild(
    { environment: "lab", appOrigin: "http://127.0.0.1:48218" },
    signal,
  );
  expect(build).toMatchObject({
    appId: "5cdfa020-c201-4da8-845a-f2cc9969eade",
    appName: "TaskNotes",
    environment: "lab",
    appOrigin: "http://127.0.0.1:48218",
    runtimeSha256:
      "58e9ed23146a956af24b936359fc79c931873eda1c8d9e297f5196f02ddaa265",
  });
  expect(fetchBundledAsset).toHaveBeenCalledExactlyOnceWith(
    expect.any(String),
    build.runtimeSha256,
    expect.any(Number),
    signal,
  );
});
