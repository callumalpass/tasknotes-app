import { describe, expect, it } from "vitest";

import {
  moveNavigationViewKey,
  navigationViewScope,
  readNavigationViewKeys,
  writeNavigationViewKeys,
} from "./navigation-views";

describe("navigation view preferences", () => {
  it("scopes navigation views to their collection", () => {
    expect(
      navigationViewScope({
        kind: "connect",
        name: "Tasks",
        location: "collection-1",
        runtime: "browser",
      }),
    ).toBe("connect:collection-1");
  });

  it("prefers the durable collection id over display location", () => {
    expect(
      navigationViewScope({
        kind: "connect",
        id: "collection-2",
        name: "Tasks",
        location: "Offline copy on this device",
        runtime: "browser",
      }),
    ).toBe("connect:collection-2");
  });

  it("preserves other collection preferences when setting and clearing", () => {
    const storage = memoryStorage();
    writeNavigationViewKeys(storage, "local:a", ["view-a", "view-c"]);
    writeNavigationViewKeys(storage, "connect:b", ["view-b"]);
    writeNavigationViewKeys(storage, "local:a", ["view-c"]);

    expect(readNavigationViewKeys(storage, "local:a")).toEqual(["view-c"]);
    expect(readNavigationViewKeys(storage, "connect:b")).toEqual(["view-b"]);
  });

  it("recovers from malformed device-local state", () => {
    const storage = memoryStorage("not-json");
    expect(readNavigationViewKeys(storage, "local:a")).toBeUndefined();
    writeNavigationViewKeys(storage, "local:a", ["view-a"]);
    expect(readNavigationViewKeys(storage, "local:a")).toEqual(["view-a"]);
  });

  it("reorders views without losing any keys", () => {
    expect(moveNavigationViewKey(["a", "b", "c"], "b", -1)).toEqual([
      "b",
      "a",
      "c",
    ]);
    expect(moveNavigationViewKey(["a", "b", "c"], "c", 1)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});

function memoryStorage(initial?: string) {
  let value = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
  };
}
