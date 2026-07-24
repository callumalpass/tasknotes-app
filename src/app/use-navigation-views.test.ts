import { describe, expect, it } from "vitest";

import { TODAY_VIEW_KEY } from "../domain/default-views";
import {
  readNavigationViewKeys,
  writeNavigationViewKeys,
} from "./navigation-views";
import { resolveNavigationViewCatalog } from "./use-navigation-views";

import type { TaskViewDocument } from "../domain/view";

const info = {
  kind: "connect" as const,
  id: "collection-home",
  name: "Tasks",
  location: "Live connection through mdbase",
  runtime: "browser" as const,
};

describe("home view restoration", () => {
  it("keeps startup unresolved instead of briefly selecting Today", () => {
    const storage = memoryStorage();
    writeNavigationViewKeys(storage, "connect:collection-home", [
      "Views/work.md#open",
    ]);

    expect(resolveNavigationViewCatalog(info, [], true, storage)).toBeNull();

    const restored = resolveNavigationViewCatalog(
      info,
      [workViews()],
      true,
      storage,
    );
    expect(restored?.navigationKeys[0]).toBe("Views/work.md#open");
    expect(restored?.documents?.[1].name).toBe("Work");
  });

  it("falls back cleanly after an authoritative refresh removes the home view", () => {
    const storage = memoryStorage();
    writeNavigationViewKeys(storage, "connect:collection-home", [
      "Views/work.md#open",
    ]);

    const resolved = resolveNavigationViewCatalog(info, [], false, storage);
    expect(resolved?.navigationKeys).toEqual([TODAY_VIEW_KEY]);
    expect(readNavigationViewKeys(storage, "connect:collection-home")).toEqual([
      TODAY_VIEW_KEY,
    ]);
  });

  it("migrates preferences written before collection ids were available", () => {
    const storage = memoryStorage();
    writeNavigationViewKeys(storage, "connect:Live connection through mdbase", [
      "Views/work.md#open",
    ]);

    const restored = resolveNavigationViewCatalog(
      info,
      [workViews()],
      true,
      storage,
    );

    expect(restored?.navigationKeys[0]).toBe("Views/work.md#open");
    expect(readNavigationViewKeys(storage, "connect:collection-home")).toEqual([
      "Views/work.md#open",
    ]);
  });

  it("restores the home view when a secondary navigation view is not cached", () => {
    const storage = memoryStorage();
    writeNavigationViewKeys(storage, "connect:collection-home", [
      "Views/work.md#open",
      "Views/later.md#later",
    ]);

    const restored = resolveNavigationViewCatalog(
      info,
      [workViews()],
      true,
      storage,
    );

    expect(restored?.navigationKeys).toEqual(["Views/work.md#open"]);
    expect(readNavigationViewKeys(storage, "connect:collection-home")).toEqual([
      "Views/work.md#open",
      "Views/later.md#later",
    ]);
  });
});

function workViews(): TaskViewDocument {
  const source = {
    path: "Views/work.md",
    format: "mdbase.view",
    revision: "view-r1",
    writable: true,
  };
  return {
    id: "work",
    name: "Work",
    source,
    views: [
      {
        key: "Views/work.md#open",
        documentId: "work",
        documentName: "Work",
        id: "open",
        name: "Open work",
        properties: [],
        source,
      },
    ],
  };
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}
