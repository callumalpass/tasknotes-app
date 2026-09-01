import { describe, expect, it } from "vitest";

import {
  readNavigationViewKeys,
  writeNavigationViewKeys,
} from "./navigation-views";
import { resolveNavigationViewCatalog } from "./use-navigation-views";
import {
  SCRATCHPAD_NAVIGATION_KEY,
  SEARCH_NAVIGATION_KEY,
} from "./navigation-views";

import type { TaskViewDocument } from "../domain/view";

const info = {
  kind: "connect" as const,
  id: "collection-home",
  name: "Tasks",
  location: "Live connection through mdbase",
  runtime: "browser" as const,
};

describe("home view restoration", () => {
  it("pins working tools after the home view for a new collection", () => {
    const resolved = resolveNavigationViewCatalog(
      info,
      starterViews(),
      false,
      memoryStorage(),
    );

    expect(resolved?.navigationKeys.slice(0, 4)).toEqual([
      "TaskNotes/Views/today.base#today",
      SCRATCHPAD_NAVIGATION_KEY,
      SEARCH_NAVIGATION_KEY,
      "TaskNotes/Views/upcoming.base#upcoming",
    ]);
  });

  it.each([
    ["tasknotes:navigation-views:v3", ["views/tasknotes-app.base#today"]],
    ["tasknotes:navigation-views:v2", ["views/tasknotes-app.base#today"]],
    ["tasknotes:primary-views:v1", "views/tasknotes-app.base#today"],
    ["tasknotes:navigation-views:v2", ["views/tasknotes/today.base#today"]],
  ])("inserts working tools when migrating %s preferences", (key, value) => {
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
      "TaskNotes/Views/today.base#today",
      SCRATCHPAD_NAVIGATION_KEY,
      SEARCH_NAVIGATION_KEY,
    ]);
    expect(readNavigationViewKeys(storage, "connect:collection-home")).toEqual(
      resolved?.navigationKeys,
    );
  });

  it("keeps Search unpinned after v4 preferences are saved", () => {
    const home = "TaskNotes/Views/today.base#today";
    const storage = memoryStorage({
      "tasknotes:navigation-views:v4": JSON.stringify({
        "connect:collection-home": [home, SCRATCHPAD_NAVIGATION_KEY],
      }),
    });

    const resolved = resolveNavigationViewCatalog(
      info,
      starterViews(),
      false,
      storage,
    );

    expect(resolved?.navigationKeys).toEqual([home, SCRATCHPAD_NAVIGATION_KEY]);
  });

  it("waits for provider defaults instead of briefly selecting a tool as Home", () => {
    expect(
      resolveNavigationViewCatalog(info, [], true, memoryStorage()),
    ).toBeNull();
  });

  it("restores a TaskNotes tool as Home before saved views load", () => {
    const storage = memoryStorage();
    writeNavigationViewKeys(storage, "connect:collection-home", [
      SCRATCHPAD_NAVIGATION_KEY,
      "Views/work.md#open",
    ]);

    const cached = resolveNavigationViewCatalog(info, [], true, storage);
    expect(cached?.navigationKeys).toEqual([SCRATCHPAD_NAVIGATION_KEY]);

    const restored = resolveNavigationViewCatalog(
      info,
      [workViews()],
      true,
      storage,
    );
    expect(restored?.navigationKeys).toEqual([
      SCRATCHPAD_NAVIGATION_KEY,
      "Views/work.md#open",
    ]);
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
    const defaults = starter.flatMap((document) =>
      document.views.map((view) => view.key),
    );
    const expected = [
      defaults[0],
      SCRATCHPAD_NAVIGATION_KEY,
      SEARCH_NAVIGATION_KEY,
      ...defaults.slice(1),
    ];
    expect(resolved?.navigationKeys).toEqual(expected);
    expect(readNavigationViewKeys(storage, "connect:collection-home")).toEqual(
      expected,
    );
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
      path: `TaskNotes/Views/${id}.base`,
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
