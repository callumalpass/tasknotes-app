import { expect, it } from "vitest";
import { TaskDocumentCache } from "./task-document-cache";
import { TaskNotesTaskModel } from "../domain/tasknotes-model";

const model = new TaskNotesTaskModel();
function entry(id: string, body = "body") {
  return {
    task: model.create(
      { title: id, body },
      { id, now: "2026-09-20T00:00:00Z" },
    ),
  };
}

it("evicts least recently used complete documents independently of summaries", () => {
  const cache = new TaskDocumentCache(2);
  const a = entry("a");
  cache.set("a", a);
  cache.set("b", entry("b"));
  expect(cache.get("a")).toBe(a);
  cache.set("c", entry("c"));
  expect(cache.get("b")).toBeUndefined();
  expect(cache.get("a")).toBe(a);
  cache.delete("a");
  expect(cache.get("a")).toBeUndefined();
  cache.clear();
  expect(cache.get("c")).toBeUndefined();
});

it("enforces a conservative text-byte budget and refuses oversized retention", () => {
  const item = entry("a", "α".repeat(100));
  const bytes =
    2 * (item.task.body.length + JSON.stringify(item.task.frontmatter).length);
  const cache = new TaskDocumentCache(100, bytes + 1);
  cache.set("a", item);
  cache.set("b", entry("b", "β".repeat(100)));
  expect(cache.get("a")).toBeUndefined();
  expect(cache.get("b")).toBeDefined();
  cache.set("huge", entry("huge", "x".repeat(bytes)));
  expect(cache.get("huge")).toBeUndefined();
  expect(cache.get("b")).toBeDefined();
});
