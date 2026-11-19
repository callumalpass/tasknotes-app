import type { wire } from "@mdbase-dev/sdk";
import { describe, expect, it } from "vitest";
import {
  appSettingsPath,
  legacyAppSettingsPath,
  tasknotesSettingsDefinition,
} from "@tasknotes/model/settings";
import { classifyChangeBatch } from "./collection-changes";

const context = {
  isTaskType: (name: string) => name === "custom-task",
  isKnownTask: (id: string) => id === "indexed",
  viewTypes: new Set(["custom-base"]),
  viewSources: new Set(["source"]),
  settingsId: "settings",
  scanning: false,
};
const change: wire.Change = {
  id: "other",
  path: "ordinary.md",
  version: 1,
  kind: "put",
};
function classify(changes: Partial<wire.Change>[], scanning = false) {
  return classifyChangeBatch(
    {
      cursor: "1",
      reset: false,
      changes: changes.map((c) => ({ ...change, ...c })),
    },
    { ...context, scanning },
  );
}

describe("collection change evidence", () => {
  it("includes older producers, implementing types, indexed files and all records during scans", () => {
    expect([
      ...classify([
        {},
        { id: "explicit", types: ["custom-task"] },
        { id: "indexed", entity: "file", kind: "remove" },
        { id: "non-task", types: [] },
        { id: "file", entity: "file" },
      ]).tasks,
    ]).toEqual([
      ["other", "put"],
      ["explicit", "put"],
      ["indexed", "remove"],
    ]);
    expect([
      ...classify(
        [{ types: [] }, { id: "file", entity: "file" }],
        true,
      ).tasks.keys(),
    ]).toEqual(["other"]);
    expect(classify([{ entity: "file" }]).data).toBe(false);
    expect(classify([{ types: [] }]).data).toBe(true);
    expect(classify([{}, { kind: "remove" }]).tasks.get("other")).toBe(
      "remove",
    );
  });
  it("recognizes settings by identity and both supported paths, and reserved definitions", () => {
    for (const c of [
      { id: "settings" },
      ...[
        appSettingsPath(tasknotesSettingsDefinition.app),
        legacyAppSettingsPath(tasknotesSettingsDefinition.app),
        "_types/t",
        "_contracts/c",
        "_schemas/s",
      ].map((path) => ({ path })),
    ])
      expect(classify([c]).model).toBe(true);
    expect(classify([{}]).model).toBe(false);
  });
  it("recognizes view sources by path, implementing type or remembered record", () => {
    for (const c of [
      { path: "folder/view.base" },
      { path: "_views/foo.md" },
      { id: "source" },
      { types: ["custom-base"] },
    ])
      expect(classify([c]).views).toBe(true);
    expect(classify([{ types: ["custom-task"] }]).views).toBe(false);
  });
  it("resets on unplaceable evidence, an explicit reset or a full SDK page", () => {
    expect(classify([{ path: "" }]).reset).toBe(true);
    expect(
      classifyChangeBatch({ changes: [], cursor: "1", reset: true }, context)
        .reset,
    ).toBe(true);
    expect(classify(Array(999).fill(change)).reset).toBe(false);
    expect(classify(Array(1000).fill(change)).reset).toBe(true);
  });
});
