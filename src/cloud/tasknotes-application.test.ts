import { afterEach, expect, it, vi } from "vitest";
import { Capacitor } from "@capacitor/core";
import * as sdk from "@mdbase-dev/sdk";
import { createTestMdbase } from "@mdbase-dev/sdk/testing";
import manifest from "../generated/mdbase-app.json";
import {
  taskNotesApplicationDeclaration,
  taskNotesMdbase,
  taskNotesUnsyncedStorage,
} from "./tasknotes-application";

vi.mock("@mdbase-dev/sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@mdbase-dev/sdk")>()),
  createMdbase: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each([
  [false, "browser"],
  [true, "device"],
] as const)(
  "says where work before connecting is kept (native %s → %s)",
  (native, storage) => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(native);
    expect(taskNotesUnsyncedStorage()).toBe(storage);
  },
);

it.each([undefined, "", "https://editor.example.test/"])(
  "refuses next host startup with missing/invalid Editor configuration %s",
  (editorOrigin) => {
    const appOrigin = "http://127.0.0.1:48218";
    vi.stubEnv("VITE_TASKNOTES_ENVIRONMENT", "lab");
    vi.stubEnv("VITE_TASKNOTES_LAB_ORIGIN", appOrigin);
    vi.stubEnv("VITE_TASKNOTES_EDITOR_ORIGIN", editorOrigin);
    vi.stubGlobal("window", { location: { origin: appOrigin } });
    expect(() => taskNotesMdbase()).toThrow("VITE_TASKNOTES_EDITOR_ORIGIN");
  },
);

it("passes exact generated manifest and original compatibility storage data to the SDK", () => {
  const declaration = taskNotesApplicationDeclaration({
    environment: "lab",
    appOrigin: "http://127.0.0.1:48218",
  });
  // Logical manifest identity, never a per-manifest registration UUID.
  expect(declaration.id).toBe("dev.tasknotes.app");
  expect(declaration.id).toBe(manifest.id);
  expect(declaration.name).toBe("TaskNotes");
  expect(declaration.manifest).toBe(manifest);
  expect(declaration.storage).toEqual({
    applicationNamespace: "tasknotes-web",
    joinDatabaseName: "tasknotes.native-collection-join.v1",
    setupDatabaseName: "tasknotes.native-model-setup.v1",
    unsyncedDatabaseName: "tasknotes.unsynced.v1",
  });
  expect(Object.keys(declaration).sort()).toEqual([
    "environment",
    "id",
    "manifest",
    "name",
    "origin",
    "storage",
  ]);
});

it("declares the exact staging environment and origin to the SDK", () => {
  const declaration = taskNotesApplicationDeclaration({
    environment: "staging",
    appOrigin: "https://staging.tasknotes.dev",
  });
  expect(declaration.environment).toBe("staging");
  expect(declaration.origin).toBe("https://staging.tasknotes.dev");
  expect(declaration.id).toBe(manifest.id);
  expect(declaration.manifest).toBe(manifest);
});

it("declares the exact production environment and origin to the SDK", () => {
  const declaration = taskNotesApplicationDeclaration({
    environment: "production",
    appOrigin: "https://app.tasknotes.dev",
  });
  expect(declaration.environment).toBe("production");
  expect(declaration.origin).toBe("https://app.tasknotes.dev");
});

it("starts the web SDK with work before connecting", async () => {
  const mdbase = await createTestMdbase({ phase: "signed_out" });
  const createMdbase = vi.mocked(sdk.createMdbase).mockReturnValue(mdbase);
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(false);
  vi.stubEnv("VITE_TASKNOTES_ENVIRONMENT", "staging");
  vi.stubEnv("VITE_TASKNOTES_LAB_ORIGIN", "");
  vi.stubEnv(
    "VITE_TASKNOTES_EDITOR_ORIGIN",
    "https://editor-staging.mdbase.dev",
  );
  vi.stubGlobal("window", {
    location: { origin: "https://staging.tasknotes.dev" },
  });

  expect(taskNotesMdbase()).toBe(mdbase);
  expect(createMdbase).toHaveBeenCalledWith(
    expect.objectContaining({ environment: "staging" }),
    { followVisibility: true, unsynced: true },
  );
});

it("starts the native SDK with work before connecting and native sign-in", async () => {
  vi.resetModules();
  const fresh = await import("@mdbase-dev/sdk");
  const { Capacitor: freshCapacitor } = await import("@capacitor/core");
  const { taskNotesMdbase: freshEntry } =
    await import("./tasknotes-application");
  const mdbase = await createTestMdbase({ phase: "signed_out" });
  const createMdbase = vi.mocked(fresh.createMdbase).mockReturnValue(mdbase);
  vi.spyOn(freshCapacitor, "isNativePlatform").mockReturnValue(true);
  vi.spyOn(freshCapacitor, "getPlatform").mockReturnValue("android");
  vi.stubEnv("VITE_TASKNOTES_ENVIRONMENT", "production");
  vi.stubEnv("VITE_TASKNOTES_LAB_ORIGIN", "");
  vi.stubEnv("VITE_TASKNOTES_EDITOR_ORIGIN", "https://editor.mdbase.dev");
  vi.stubGlobal("window", {
    location: { origin: "https://app.tasknotes.dev" },
  });

  expect(freshEntry()).toBe(mdbase);
  expect(createMdbase).toHaveBeenCalledWith(
    expect.objectContaining({ environment: "production" }),
    expect.objectContaining({
      followVisibility: true,
      unsynced: true,
      signIn: expect.objectContaining({
        returnUrl: "dev.tasknotes.app://auth/mdbase/callback",
      }),
    }),
  );
});
