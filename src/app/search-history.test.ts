import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearHistory,
  forgetHistory,
  historyScope,
  readHistory,
  rememberHistory,
  rememberOpenedTask,
} from "./search-history";

afterEach(() => localStorage.clear());

describe("search history", () => {
  it("keeps the five newest searches, deduplicated without regard to case", () => {
    for (const query of ["one", "two", "three", "four", "five", "six"])
      rememberHistory("searches", "scope", query);
    rememberHistory("searches", "scope", "  FOUR ");
    expect(readHistory("searches", "scope")).toEqual([
      "FOUR",
      "six",
      "five",
      "three",
      "two",
    ]);
  });

  it("ignores blank searches", () => {
    rememberHistory("searches", "scope", "   ");
    expect(readHistory("searches", "scope")).toEqual([]);
  });

  it("scopes history to a collection and clears one kind at a time", () => {
    rememberHistory("searches", "a", "plan");
    rememberHistory("tasks", "a", "tasks/one.md");
    rememberHistory("searches", "b", "other");
    clearHistory("searches", "a");
    expect(readHistory("searches", "a")).toEqual([]);
    expect(readHistory("tasks", "a")).toEqual(["tasks/one.md"]);
    expect(readHistory("searches", "b")).toEqual(["other"]);
  });

  it("forgets tasks that no longer exist", () => {
    rememberHistory("tasks", "a", "tasks/one.md");
    rememberHistory("tasks", "a", "tasks/two.md");
    forgetHistory("tasks", "a", ["tasks/one.md"]);
    expect(readHistory("tasks", "a")).toEqual(["tasks/two.md"]);
  });

  it("tolerates unavailable or corrupt storage", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(rememberHistory("searches", "a", "plan", broken)).toEqual(["plan"]);
    expect(readHistory("searches", "a", broken)).toEqual([]);
    expect(() => clearHistory("searches", "a", broken)).not.toThrow();
    localStorage.setItem("tasknotes:recent-searches:v1:a", "{nope");
    expect(readHistory("searches", "a")).toEqual([]);
  });

  it("records an opened task under its collection scope", async () => {
    const info = {
      kind: "connect" as const,
      id: "account:collection",
      name: "Demo",
      location: "demo",
      runtime: "browser" as const,
    };
    const collectionInfo = vi.fn().mockResolvedValue(info);
    rememberOpenedTask({ collectionInfo }, "tasks/one.md");
    await vi.waitFor(() =>
      expect(readHistory("tasks", historyScope(info))).toEqual([
        "tasks/one.md",
      ]),
    );
  });
});
