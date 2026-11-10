import { afterEach, expect, it, vi } from "vitest";
import {
  parseFrontmatter,
  serializeMarkdownDocument,
} from "@tasknotes/model/frontmatter";
import {
  taskNotesMdbaseTypeDisagreements,
  TaskNotesVocabularyInUseError,
} from "@tasknotes/model/mdbase";
import { nextTaskFixture, seedTask } from "../test/next-task-fixture";

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

async function vocabulary(f: Awaited<ReturnType<typeof fixture>>) {
  const { statuses, priorities } = await f.repository.taskConfiguration();
  return {
    statuses: [...statuses]
      .sort((first, second) => first.order - second.order)
      .map(({ value, label, color, isCompleted }) => ({
        value,
        label,
        color,
        isCompleted,
      })),
    priorities: [...priorities]
      .sort((first, second) => first.weight - second.weight)
      .map(({ value, label, color }) => ({ value, label, color })),
  };
}
it("adds a status, a priority and a custom field to the task type", async () => {
  const f = await fixture();
  const current = await vocabulary(f);
  const configuration = await f.repository.updateTaskModelSettings({
    statuses: [
      ...current.statuses,
      {
        value: "waiting",
        label: "Waiting",
        color: "#aa5500",
        isCompleted: false,
      },
    ],
    priorities: [
      ...current.priorities,
      { value: "urgent", label: "Urgent", color: "#cc0000" },
    ],
    userFields: {
      add: [{ key: "client", displayName: "Client", type: "text" }],
    },
  });
  expect(configuration.statuses.at(-1)).toMatchObject({
    value: "waiting",
    label: "Waiting",
    color: "#aa5500",
    isCompleted: false,
  });
  expect(
    [...configuration.priorities].sort(
      (first, second) => first.weight - second.weight,
    ),
  ).toMatchObject([...current.priorities, { value: "urgent" }]);
  expect(configuration.userFields).toContainEqual(
    expect.objectContaining({
      key: "client",
      displayName: "Client",
      type: "text",
    }),
  );
  // The type file itself carries the change, for every other client.
  const source = await f.client.resources.get("_types/task.md");
  expect(source.text).toContain("waiting");
  expect(source.text).toContain("client");

  const created = await f.repository.create({
    title: "Chase the supplier",
    status: "waiting",
    priority: "urgent",
  });
  expect(created).toMatchObject({ status: "waiting", priority: "urgent" });
});
it("refuses to remove a status that tasks still hold", async () => {
  const f = await fixture();
  const current = await vocabulary(f);
  const open = current.statuses.find(({ isCompleted }) => !isCompleted)!;
  const spare = current.statuses.find(
    (status) => !status.isCompleted && status.value !== open.value,
  );
  const removed =
    (await f.repository.taskConfiguration()).defaults.status === open.value
      ? spare!
      : open;
  seedTask(f.replica, { title: "Still here", status: removed.value });
  const before = await f.client.resources.get("_types/task.md");
  const submit = vi.spyOn(f.client, "submit");
  const refusal = await f.repository
    .updateTaskModelSettings({
      statuses: current.statuses.filter(({ value }) => value !== removed.value),
    })
    .catch((reason: unknown) => reason);
  expect(refusal).toBeInstanceOf(TaskNotesVocabularyInUseError);
  expect(refusal).toMatchObject({
    list: "status",
    value: removed.value,
    count: 1,
  });
  expect(submit).not.toHaveBeenCalled();
  expect(await f.client.resources.get("_types/task.md")).toEqual(before);
});
it("removes an unused status and keeps the new priority order", async () => {
  const f = await fixture();
  const current = await vocabulary(f);
  const { defaults } = await f.repository.taskConfiguration();
  const removed = current.statuses.find(
    (status) => !status.isCompleted && status.value !== defaults.status,
  )!;
  const reversed = [...current.priorities].reverse();
  const configuration = await f.repository.updateTaskModelSettings({
    statuses: current.statuses.filter(({ value }) => value !== removed.value),
    priorities: reversed,
  });
  expect(configuration.statuses.map(({ value }) => value)).not.toContain(
    removed.value,
  );
  expect(
    [...configuration.priorities]
      .sort((first, second) => first.weight - second.weight)
      .map(({ value }) => value),
  ).toEqual(reversed.map(({ value }) => value));
  expect(configuration.defaults).toEqual(defaults);
  // A reload reads the same lists back from the type file.
  expect(
    (await f.repository.taskConfiguration()).statuses.map(({ value }) => value),
  ).toEqual(configuration.statuses.map(({ value }) => value));
});
it("leaves a hand-edited type with one list of statuses when it saves settings", async () => {
  const f = await fixture();
  const source = await f.client.resources.get("_types/task.md");
  const parsed = parseFrontmatter(source.text!);
  const type = structuredClone(parsed.frontmatter) as {
    schema: { value: { properties: { status: { enum: string[] } } } };
  };
  // Someone allowed a status in the schema and did not describe it.
  type.schema.value.properties.status.enum = [
    ...type.schema.value.properties.status.enum,
    "blocked",
  ];
  f.replica.seedResource(
    "_types/task.md",
    serializeMarkdownDocument(type, parsed.body),
  );
  const seeded = await f.client.resources.get("_types/task.md");
  expect(
    taskNotesMdbaseTypeDisagreements(
      parseFrontmatter(seeded.text!).frontmatter,
    ),
  ).not.toEqual([]);

  const { defaults } = await f.repository.taskConfiguration();
  const configuration = await f.repository.updateTaskModelSettings({
    defaultPriority: defaults.priority === "high" ? "low" : "high",
  });

  const saved = parseFrontmatter(
    (await f.client.resources.get("_types/task.md")).text!,
  ).frontmatter;
  expect(taskNotesMdbaseTypeDisagreements(saved)).toEqual([]);
  expect(configuration.statuses.map(({ value }) => value)).toContain("blocked");
});
