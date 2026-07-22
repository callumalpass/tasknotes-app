import { describe, expect, it } from "vitest";

import {
  primaryViewScope,
  readPrimaryViewKey,
  writePrimaryViewKey,
} from "./primary-view";

describe("primary saved view preferences", () => {
  it("scopes a primary view to its collection", () => {
    expect(
      primaryViewScope({
        kind: "connect",
        name: "Tasks",
        location: "collection-1",
        runtime: "browser",
      }),
    ).toBe("connect:collection-1");
  });

  it("preserves other collection preferences when setting and clearing", () => {
    const storage = memoryStorage();
    writePrimaryViewKey(storage, "local:a", "view-a");
    writePrimaryViewKey(storage, "connect:b", "view-b");
    writePrimaryViewKey(storage, "local:a");

    expect(readPrimaryViewKey(storage, "local:a")).toBeUndefined();
    expect(readPrimaryViewKey(storage, "connect:b")).toBe("view-b");
  });

  it("recovers from malformed device-local state", () => {
    const storage = memoryStorage("not-json");
    expect(readPrimaryViewKey(storage, "local:a")).toBeUndefined();
    writePrimaryViewKey(storage, "local:a", "view-a");
    expect(readPrimaryViewKey(storage, "local:a")).toBe("view-a");
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
