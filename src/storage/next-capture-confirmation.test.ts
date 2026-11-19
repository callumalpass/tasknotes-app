import type { RecordView } from "@mdbase-dev/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTaskFixture } from "../test/next-task-fixture";

const closers: (() => void)[] = [];
afterEach(() => {
  while (closers.length) closers.pop()!();
  vi.restoreAllMocks();
});

/** On the real engine a new task's portable ID is not its native record ID:
 * the record reads back without an `id` field, so the task's ID is its path. */
function withoutPortableId(record: RecordView): RecordView {
  const strip = (fields?: Record<string, unknown> | null) => {
    if (!fields) return fields;
    const rest = { ...fields };
    delete rest.id;
    return rest;
  };
  return {
    ...record,
    frontmatter: strip(record.frontmatter),
    effective: strip(record.effective),
  } as RecordView;
}

describe("a created task whose portable ID is not its record ID (#518)", () => {
  for (const confirmDelayMs of [0, null] as const)
    it(`settles each create and its confirmation (confirmDelayMs ${confirmDelayMs})`, async () => {
      const f = await nextTaskFixture({ confirmDelayMs });
      closers.push(f.close);
      const get = f.client.get.bind(f.client);
      const find = f.client.find.bind(f.client);
      vi.spyOn(f.client, "get").mockImplementation(async (...args) =>
        withoutPortableId(await get(...args)),
      );
      vi.spyOn(f.client, "find").mockImplementation(async (...args) => {
        const record = await find(...args);
        return record && withoutPortableId(record);
      });
      for (let i = 0; i < 3; i++) {
        const intent = { id: crypto.randomUUID() };
        const created = await f.repository.create(
          { title: `Captured ${i}` } as never,
          intent,
        );
        expect(created.title).toBe(`Captured ${i}`);
        expect(created.id).not.toBe(intent.id);
        if (confirmDelayMs === null) f.replica.confirmAll();
        await vi.waitFor(() =>
          expect(
            f.repository.writeState({ kind: "task", id: created.id }),
          ).toBeUndefined(),
        );
      }
      const titles = (await f.repository.listSummaries({})).map(
        (task) => task.title,
      );
      expect(titles.sort()).toEqual(["Captured 0", "Captured 1", "Captured 2"]);
    });
});
