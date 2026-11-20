import { afterEach, expect, it, vi } from "vitest";
import { Capacitor } from "@capacitor/core";
import { createMdbase } from "@mdbase-dev/sdk";
import { TASKNOTES_NATIVE_RETURN_URL } from "../native/sign-in";

vi.mock("@mdbase-dev/sdk", async (importOriginal) => ({
  createMdbase: vi.fn(
    (await importOriginal<typeof import("@mdbase-dev/sdk")>()).createMdbase,
  ),
}));
vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: vi.fn(),
  },
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each([
  {
    platform: "ios",
    origin: "capacitor://app.tasknotes.dev",
    webViewOrigin: "null",
    grantReturnUrl: undefined,
  },
  {
    platform: "android",
    origin: "https://app.tasknotes.dev",
    webViewOrigin: "https://app.tasknotes.dev",
    grantReturnUrl: "https://app.tasknotes.dev/auth/mdbase/callback?via=app",
  },
])(
  "constructs the real production SDK on $platform",
  async ({ platform, origin, webViewOrigin, grantReturnUrl }) => {
    vi.resetModules();
    const { taskNotesMdbase } = await import("./tasknotes-application");
    vi.mocked(Capacitor.getPlatform).mockReturnValue(platform);
    vi.stubEnv("VITE_TASKNOTES_ENVIRONMENT", "production");
    vi.stubEnv("VITE_TASKNOTES_LAB_ORIGIN", "");
    vi.stubEnv("VITE_TASKNOTES_EDITOR_ORIGIN", "https://editor.mdbase.dev");
    vi.stubGlobal("window", {
      location: {
        origin: webViewOrigin,
        protocol: new URL(origin).protocol,
        host: "app.tasknotes.dev",
      },
    });
    const entry = taskNotesMdbase();
    expect(createMdbase).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        origin,
        environment: "production",
        manifest: expect.objectContaining({
          homepage: "https://app.tasknotes.dev/",
        }),
      }),
      expect.objectContaining({
        signIn: expect.objectContaining({
          returnUrl: TASKNOTES_NATIVE_RETURN_URL,
          open: expect.any(Function),
          close: expect.any(Function),
        }),
      }),
    );
    expect(
      vi.mocked(createMdbase).mock.calls[0]?.[1]?.signIn?.grantReturnUrl,
    ).toBe(grantReturnUrl);
    expect(taskNotesMdbase()).toBe(entry);
    expect(createMdbase).toHaveBeenCalledOnce();
  },
);
