import { MdbaseError, type wire } from "@mdbase-dev/sdk";
import { nextTaskFixture } from "../test/next-task-fixture";
import { defaultTaskCollectionConfiguration } from "../domain/task-configuration";

// Actual SDK/MemoryReplica CRUD; synthetic catalog and assignment-query frames.
// These checks do not qualify native CEL/link resolution or the People bridge.
const fixtures: Awaited<ReturnType<typeof nextTaskFixture>>[] = [];
afterEach(() => {
  fixtures.splice(0).forEach((f) => f.close());
  vi.restoreAllMocks();
});
async function fixture() {
  const config = defaultTaskCollectionConfiguration();
  const f = await nextTaskFixture({}, false, {
    fieldMapping: { ...config.fieldMapping, assignees: "owners" },
  });
  fixtures.push(f);
  return f;
}

it("creates, updates and clears assignments through the actual mapped field without replacing task identity", async () => {
  const f = await fixture();
  const create = vi.spyOn(f.client, "create");
  const update = vi.spyOn(f.client, "update");
  const task = await f.repository.create({
    title: "Mapped assignees",
    assignees: ["[[people/Alex.md]]"],
  });
  const original = create.mock.calls[0]![0].id!;
  const created = await f.client.get(original);
  expect(created.frontmatter.get("owners")).toEqual(["[[people/Alex.md]]"]);
  expect(created.frontmatter.has("assignees")).toBe(false);
  const changed = await f.repository.update(task.id, {
    assignees: ["[Sam](team/Sam.md)"],
  });
  expect(changed.id).toBe(task.id);
  expect(changed.assignees).toEqual(["[Sam](team/Sam.md)"]);
  expect(update.mock.calls[0]![0]).toMatchObject({ id: original });
  expect(update.mock.calls[0]![1].ifRevision).toBe(created.revision);
  expect(update.mock.calls[0]![1].patch).toMatchObject({
    owners: ["[Sam](team/Sam.md)"],
  });
  const cleared = await f.repository.update(task.id, { assignees: [] });
  expect(cleared.id).toBe(task.id);
  expect(cleared.assignees).toEqual([]);
  expect(
    (await f.client.get(original)).frontmatter.get("owners") ?? [],
  ).toEqual([]);
  expect(create).toHaveBeenCalledOnce();
});

async function filterFixture() {
  const f = await fixture();
  const assigned = await f.repository.create({
    title: "Assigned",
    assignees: ["[[Alex]]"],
  });
  const other = await f.repository.create({
    title: "Other Alex",
    assignees: ["[[elsewhere/Alex.md]]"],
  });
  await f.repository.listSummaries();
  const records: wire.RecordView[] = [];
  for await (const page of f.client.pages({ types: ["task"] }))
    records.push(...page.records);
  const selected = records.find((r) => r.path === assigned.path)!;
  const where =
    '"owners" in record && record["owners"] != null && record["owners"].exists(link, link != null && link.asFile() != null && link.asFile().file.path == "people/Alex.md")';
  return { f, assigned, other, selected, where };
}

it("filters only native-resolved assignment paths, using the mapped field rather than basename guesses", async () => {
  const { f, assigned, other, selected, where } = await filterFixture();
  const originalPages = f.client.pages.bind(f.client);
  const pages = vi
    .spyOn(f.client, "pages")
    .mockImplementation(async function* (query, include, signal, options) {
      if (query.where !== where) {
        yield* originalPages(query, include, signal, options);
        return;
      }
      yield { records: [selected], asOf: 1, complete: true };
    });
  const result = await f.repository.listSummaries({
    assignedTo: "people/Alex.md",
  });
  expect(result.map((task) => task.id)).toEqual([assigned.id]);
  expect(result.some((task) => task.id === other.id)).toBe(false);
  expect(pages).toHaveBeenCalledWith(
    { types: ["task"], where, limit: 1000 },
    undefined,
    expect.any(AbortSignal),
  );
});

it("refuses partial assignment matches rather than treating them as a complete filtered list", async () => {
  const { f, selected, where } = await filterFixture();
  const originalPages = f.client.pages.bind(f.client);
  vi.spyOn(f.client, "pages").mockImplementation(
    async function* (query, include, signal, options) {
      if (query.where !== where) {
        yield* originalPages(query, include, signal, options);
        return;
      }
      yield { records: [selected], asOf: 1, complete: false };
    },
  );
  await expect(
    f.repository.listSummaries({ assignedTo: "people/Alex.md" }),
  ).rejects.toThrow("complete assignment matches");
});

it("never substitutes cached unfiltered tasks when assignment matching is unavailable", async () => {
  const { f, where } = await filterFixture();
  const originalPages = f.client.pages.bind(f.client);
  vi.spyOn(f.client, "pages").mockImplementation(
    async function* (query, include, signal, options) {
      if (query.where !== where) {
        yield* originalPages(query, include, signal, options);
        return;
      }
      throw new MdbaseError({
        code: "unavailable",
        message: "Assignment query unavailable",
        recovery: "retry",
      });
    },
  );
  await expect(
    f.repository.search({ assignedTo: "people/Alex.md" }),
  ).rejects.toThrow("Assignment query unavailable");
});
