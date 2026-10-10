import { afterEach, expect, it, vi } from "vitest";
import {
  parseFrontmatter,
  serializeMarkdownDocument,
} from "@tasknotes/model/frontmatter";
import { nextTaskFixture } from "../test/next-task-fixture";

const fixtures: Awaited<ReturnType<typeof nextTaskFixture>>[] = [];
async function fixture() {
  const f = await nextTaskFixture();
  fixtures.push(f);
  return f;
}
afterEach(() => {
  fixtures.splice(0).forEach((f) => f.close());
  vi.restoreAllMocks();
});
async function addProvider(f: Awaited<ReturnType<typeof fixture>>) {
  const source = await f.client.resources.get("_types/task.md");
  const parsed = parseFrontmatter(source.text!);
  f.replica.seedResource(
    "_types/work-task.md",
    serializeMarkdownDocument(
      { ...parsed.frontmatter, name: "work-task" },
      parsed.body,
    ),
  );
  f.catalog.types.push({
    ...structuredClone(f.catalog.types[0]!),
    name: "work-task",
    path: "_types/work-task.md",
  });
}

// SDK protocol/catalog stand-in; checks selection safety, not native execution.
it("makes collection-wide settings explicitly read-only with multiple providers and cannot bypass the guard", async () => {
  const f = await fixture();
  await addProvider(f);
  const before = await f.client.resources.get("_types/task.md");
  const submit = vi.spyOn(f.client, "submit");
  expect(await f.repository.taskModelSettingsAccess()).toMatchObject({
    writable: false,
    reason: expect.stringContaining("several task types"),
  });
  await expect(
    f.repository.updateTaskModelSettings({ defaultPriority: "high" }),
  ).rejects.toThrow("several task types");
  expect(submit).not.toHaveBeenCalled();
  expect(await f.client.resources.get("_types/task.md")).toEqual(before);
});
it("rechecks provider selection before preparing a settings mutation", async () => {
  const f = await fixture();
  expect(await f.repository.taskModelSettingsAccess()).toMatchObject({
    writable: true,
  });
  await addProvider(f);
  const submit = vi.spyOn(f.client, "submit");
  await expect(
    f.repository.updateTaskModelSettings({ defaultPriority: "high" }),
  ).rejects.toThrow("selection changed");
  expect(submit).not.toHaveBeenCalled();
});
it("retains single-provider settings updates", async () => {
  const f = await fixture();
  expect(await f.repository.taskModelSettingsAccess()).toMatchObject({
    writable: true,
    source: "_types/task.md",
  });
  const configuration = await f.repository.updateTaskModelSettings({
    defaultPriority: "high",
  });
  expect(configuration.defaults.priority).toBe("high");
});
