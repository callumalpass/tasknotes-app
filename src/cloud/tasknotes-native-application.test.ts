import { afterEach, expect, it, vi } from "vitest";
const create = vi.hoisted(() => vi.fn(() => ({})));
vi.mock("@mdbase-dev/sdk", () => ({ createMdbase: create }));
vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => "ios",
  },
}));
import { taskNotesMdbase } from "./tasknotes-application";
import { TASKNOTES_NATIVE_RETURN_URL } from "../native/sign-in";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("starts the canonical SDK with the actual opaque iOS origin and native browser return", () => {
  vi.stubEnv("VITE_TASKNOTES_ENVIRONMENT", "production");
  vi.stubEnv("VITE_TASKNOTES_LAB_ORIGIN", "");
  vi.stubEnv("VITE_TASKNOTES_EDITOR_ORIGIN", "https://editor.mdbase.dev");
  vi.stubGlobal("window", {
    location: {
      origin: "null",
      protocol: "capacitor:",
      host: "app.tasknotes.dev",
    },
  });
  const entry = taskNotesMdbase();
  expect(create).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      origin: "capacitor://app.tasknotes.dev",
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
  expect(taskNotesMdbase()).toBe(entry);
  expect(create).toHaveBeenCalledOnce();
});
