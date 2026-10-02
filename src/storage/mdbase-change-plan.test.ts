import { expect, it } from "vitest";
import { normalizeCollectionChange } from "@mdbase-dev/connect";
import { changedRecordPaths } from "./mdbase-change-plan";

const event = (
  type: string,
  payload: Parameters<typeof normalizeCollectionChange>[0]["payload"],
) =>
  normalizeCollectionChange({
    cursor: 1,
    type,
    payload,
    occurred_at: "2026-10-02T00:00:00Z",
  });

it("uses typed record identities and coalesces rename paths", () => {
  expect(
    changedRecordPaths([
      event("mdbase.record.created", { path: "tasks/one.md" }),
      event("mdbase.record.modified", {
        path: "tasks/one.md",
        body_changed: true,
      }),
      event("mdbase.record.deleted", { path: "tasks/two.md" }),
      event("mdbase.record.renamed", {
        from: "tasks/two.md",
        to: "tasks/three.md",
      }),
    ]),
  ).toEqual(new Set(["tasks/one.md", "tasks/two.md", "tasks/three.md"]));
});

it.each([
  ["future.event", {}],
  ["mdbase.record.modified", { path: 42 }],
  ["mdbase.record.renamed", { from: "tasks/one.md" }],
  ["mdbase.type.changed", { name: "task" }],
  ["mdbase.resource.changed", { path: "image.png" }],
  ["mdbase.collection.invalidated", {}],
] as const)(
  "fully reconciles %s rather than interpreting partial payloads",
  (type, payload) => {
    expect(changedRecordPaths([event(type, payload)])).toBeNull();
  },
);

it.each(["mdbase.view.changed", "mdbase.view_source.changed"])(
  "skips task hydration for %s",
  (type) => {
    expect(
      changedRecordPaths([event(type, { path: "views/tasks.base" })]),
    ).toEqual(new Set());
  },
);
