import { describe, expect, it } from "vitest";

import {
  readNavigationViewKeys,
  writeNavigationViewKeys,
} from "./navigation-views";
import { resolveNavigationViewCatalog } from "./use-navigation-views";
import { SCRATCHPAD_NAVIGATION_KEY } from "./navigation-views";

import type { TaskViewDocument } from "../domain/view";

const info = {
  kind: "connect" as const,
  id: "collection-home",
  name: "Tasks",
  location: "Live connection through mdbase",
  runtime: "browser" as const,
};

describe("home view restoration", () => {
  it("pins Scratchpad second for a new collection", () => {
    const resolved = resolveNavigationViewCatalog(
      info,
      starterViews(),
      false,
      memoryStorage(),
    );

    expect(resolved?.navigationKeys.slice(0, 3)).toEqual([
      "views/tasknotes/today.base#today",
      SCRATCHPAD_NAVIGATION_KEY,
      "views/tasknotes/upcoming.base#upcoming",
    ]);
  });

  it.each([
    ["tasknotes:navigation-views:v2", ["views/tasknotes-app.base#today"]],
    ["tasknotes:primary-views:v1", "views/tasknotes-app.base#today"],
  ])("inserts Scratchpad when migrating %s preferences", (key, value) => {
    const storage = memoryStorage({
      [key]: JSON.stringify({ "connect:collection-home": value }),
    });

    const resolved = resolveNavigationViewCatalog(
      info,
      starterViews(),
      false,
      storage,
    );

    expect(resolved?.navigationKeys).toEqual([
      "views/tasknotes/today.base#today",
      SCRATCHPAD_NAVIGATION_KEY,
    ]);
    expect(readNavigationViewKeys(storage, "connect:collection-home")).toEqual(
      resolved?.navigationKeys,
    );
  });

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
    expect(restored?.documents?.[0].name).toBe("Work");
  });

  it("falls back cleanly after an authoritative refresh removes the home view", () => {
    const storage = memoryStorage();
    writeNavigationViewKeys(storage, "connect:collection-home", [
      "Views/work.md#open",
    ]);

    const starter = starterViews();
    const resolved = resolveNavigationViewCatalog(
      info,
      starter,
      false,
      storage,
    );
    expect(resolved?.navigationKeys).toEqual(
      starter.flatMap((document) => document.views.map((view) => view.key)),
    );
    expect(readNavigationViewKeys(storage, "connect:collection-home")).toEqual([
      ...starter.flatMap((document) => document.views.map((view) => view.key)),
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

function starterViews(): TaskViewDocument[] {
  return ["today", "upcoming", "calendar"].map((id) => {
    const source = {
      path: `views/tasknotes/${id}.base`,
      format: "obsidian.base",
      revision: "view-r1",
      writable: true,
    };
    return {
      id,
      name: id,
      source,
      views: [
        {
          key: `${source.path}#${id}`,
          documentId: id,
          documentName: id,
          id,
          name: `${id[0].toUpperCase()}${id.slice(1)}`,
          properties: [],
          source,
        },
      ],
    };
  });
}

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}
