import {
  requireNativeBuildSelection,
  loadNativeBuild,
} from "./next-native-build";
const origin = "http://127.0.0.1:48218";
describe("native BUILD selection fails closed", () => {
  it.each([undefined, "development", "test", "production", "staging", ""])(
    "refuses %s even if LAB environment variables are present",
    (mode) => {
      expect(() =>
        requireNativeBuildSelection(mode, "lab", origin, origin),
      ).toThrow("no authenticated release bundle");
    },
  );
  it("requires explicit LAB mode, environment and the exact bundled origin", () => {
    expect(requireNativeBuildSelection("lab", "lab", origin, origin)).toEqual({
      environment: "lab",
      appOrigin: origin,
    });
    expect(() =>
      requireNativeBuildSelection("lab", "production", origin, origin),
    ).toThrow();
    expect(() =>
      requireNativeBuildSelection(
        "lab",
        "lab",
        "http://localhost:48218",
        origin,
      ),
    ).toThrow();
    expect(() =>
      requireNativeBuildSelection(
        "lab",
        "lab",
        origin,
        "https://app.tasknotes.dev",
      ),
    ).toThrow();
  });
  it("the default test build never fetches artifacts or imports LAB release context", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    try {
      await expect(
        loadNativeBuild(new AbortController().signal),
      ).rejects.toThrow("no authenticated release bundle");
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });
});
