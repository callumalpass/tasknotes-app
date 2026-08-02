import { describe, expect, it, vi } from "vitest";

import { QueryInvalidationStore } from "./query-invalidation";

describe("QueryInvalidationStore", () => {
  it("notifies only affected detail and query subscribers", () => {
    const store = new QueryInvalidationStore();
    const taskOne = vi.fn();
    const taskTwo = vi.fn();
    const list = vi.fn();
    store.subscribe("task:one", taskOne);
    store.subscribe("task:two", taskTwo);
    store.subscribe("tasks:open", list);

    store.invalidateTasks(["one"]);

    expect(taskOne).toHaveBeenCalledOnce();
    expect(taskTwo).not.toHaveBeenCalled();
    expect(list).toHaveBeenCalledOnce();
    expect(store.revision("task:one")).toBe(1);
  });

  it("invalidates every active scope for an external repository change", () => {
    const store = new QueryInvalidationStore();
    const first = vi.fn();
    const second = vi.fn();
    store.subscribe("task:one", first);
    store.subscribe("view:today", second);

    store.invalidateAll();

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });
});
