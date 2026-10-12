import { expect, it } from "vitest";
import manifest from "../generated/mdbase-app.json";
import { taskNotesApplicationDeclaration } from "./tasknotes-application";

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
