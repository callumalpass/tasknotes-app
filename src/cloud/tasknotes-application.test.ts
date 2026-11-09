import { afterEach, expect, it, vi } from "vitest";
import { Capacitor } from "@capacitor/core";
import * as sdk from "@mdbase-dev/sdk";
import { createTestMdbase } from "@mdbase-dev/sdk/testing";
import manifest from "../generated/mdbase-app.json";
import {
  taskNotesApplicationDeclaration,
  taskNotesMdbase,
  taskNotesUnsyncedEnabled,
} from "./tasknotes-application";

vi.mock("@mdbase-dev/sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@mdbase-dev/sdk")>()),
  createMdbase: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each([false, true])(
  "keeps work before connecting disabled with native platform %s until SDK setup is fixed",
  (native) => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(native);
    expect(taskNotesUnsyncedEnabled()).toBe(false);
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

it("starts the web SDK without automatically opening an unsynced collection", async () => {
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
    { followVisibility: true, unsynced: false },
  );
});
