import {
  MdbaseError,
  mdbaseError,
  toPlain,
  toValue,
  type wire,
} from "@mdbase-dev/sdk";
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
  const alex = f.replica.seed({ path: "people/Alex.md", types: [], body: "" });
  const assigned = await f.repository.create({
    title: "Assigned",
    assignees: ["[[Alex]]"],
  });
  const other = await f.repository.create({
    title: "Other Alex",
    assignees: ["[[elsewhere/Alex.md]]"],
  });
  await f.repository.listSummaries();
  const view = (path: string) => f.client.get({ path });
  const link = (field?: string): wire.LinkView => ({
    raw: "[[Alex]]",
    embed: false,
    resolution: { kind: "record", target: alex.id, path: alex.path },
    ...(field ? { field } : {}),
  });
  return { f, assigned, other, view, link };
}

it("filters the person's native-resolved backlinks by the mapped field, never by basename", async () => {
  const { f, assigned, other, view, link } = await filterFixture();
  const backlinks = vi.spyOn(f.client, "backlinks").mockResolvedValue({
    backlinks: [
      { record: await view(assigned.path), links: [link("owners")] },
      // The default field name is not the mapped one, and a body link is
      // not an assignment.
      { record: await view(other.path), links: [link("assignees"), link()] },
    ],
    complete: true,
    asOf: 1,
  });
  const result = await f.repository.listSummaries({
    assignedTo: "people/Alex.md",
  });
  expect(result.map((task) => task.id)).toEqual([assigned.id]);
  expect(backlinks).toHaveBeenCalledWith(
    { path: "people/Alex.md" },
    { limit: 1000, signal: expect.any(AbortSignal) },
  );
});

it("refuses partial assignment matches rather than treating them as a complete filtered list", async () => {
  const { f, assigned, view, link } = await filterFixture();
  vi.spyOn(f.client, "backlinks").mockResolvedValue({
    backlinks: [{ record: await view(assigned.path), links: [link("owners")] }],
    complete: false,
    asOf: 1,
  });
  await expect(
    f.repository.listSummaries({ assignedTo: "people/Alex.md" }),
  ).rejects.toThrow("complete assignment matches");
});

it("never substitutes cached unfiltered tasks when assignment matching is unavailable", async () => {
  const { f } = await filterFixture();
  vi.spyOn(f.client, "backlinks").mockRejectedValue(
    new MdbaseError({
      code: "unavailable",
      message: "Assignment query unavailable",
      recovery: "retry",
    }),
  );
  await expect(
    f.repository.search({ assignedTo: "people/Alex.md" }),
  ).rejects.toThrow("Assignment query unavailable");
});

it("finds assignments on a collection larger than one query budget, from the person's backlinks", async () => {
  const config = defaultTaskCollectionConfiguration();
  const f = await nextTaskFixture(
    {
      // Only the repository's body search is evaluated here.
      where: (expr, record) => {
        const token = /^file\.body\.lower\(\)\.contains\((".*")\)$/.exec(
          expr,
        )?.[1];
        if (token === undefined) throw new Error(`unexpected where ${expr}`);
        return record.body.toLowerCase().includes(JSON.parse(token));
      },
    },
    false,
    { fieldMapping: { ...config.fieldMapping, assignees: "owners" } },
  );
  fixtures.push(f);
  const me = f.replica.seed({ path: "people/Me.md", types: [], body: "" });
  const seed = (i: number, extra: Record<string, unknown> = {}, body = "") =>
    f.replica.seed({
      path: `tasks/t${String(i).padStart(4, "0")}.md`,
      types: ["task"],
      body,
      frontmatter: Object.fromEntries(
        Object.entries({
          id: crypto.randomUUID(),
          title: `Task ${i}`,
          status: "open",
          priority: "normal",
          tags: ["task"],
          dateCreated: "2026-11-01T00:00:00.000Z",
          dateModified: "2026-11-01T00:00:00.000Z",
          ...extra,
        }).map(([key, value]) => [key, toValue(value as never)]),
      ),
    });
  const assigned = [3, 400, 801, 1102, 1199].map((i) =>
    seed(i, { owners: ["[[people/Me.md]]"] }),
  );
  for (let i = 0; i < 1200; i++) {
    if ([3, 400, 801, 1102, 1199].includes(i)) continue;
    // Links to the person outside the assignee field are not assignments.
    if (i === 10) seed(i, { projects: ["[[people/Me.md]]"] });
    else if (i === 11) seed(i, {}, "Ask [[people/Me.md]]");
    else seed(i);
  }
  // Stand-in for the budgeted native replica: a task query that resolves
  // links reads every task under one request budget and refuses past 1,000.
  const originalPages = f.client.pages.bind(f.client);
  vi.spyOn(f.client, "pages").mockImplementation(
    async function* (query, include, signal, options) {
      const tasks = f.replica.allRecords.filter((r) =>
        r.types.some((type) => query.types?.includes(type)),
      );
      if (query.where?.includes("asFile()") && tasks.length > 1000)
        throw mdbaseError(
          "too_large",
          "ordinary selection exceeds its bounded source or retained-value query budget",
          "query_budget_exceeded",
        );
      yield* originalPages(query, include, signal, options);
    },
  );
  // Core's backlinks report the frontmatter field holding each link, which
  // the in-memory replica does not; answer from frontmatter, two per page.
  const referrers = f.replica.allRecords
    .flatMap((record) => {
      const links: wire.LinkView[] = [
        ...[...record.frontmatter.entries()]
          .filter(([, value]) =>
            JSON.stringify(toPlain(value)).includes("[[people/Me.md]]"),
          )
          .map(([field]) => ({ field })),
        ...(record.body.includes("[[people/Me.md]]") ? [{}] : []),
      ].map((link) => ({
        raw: "[[people/Me.md]]",
        embed: false,
        resolution: { kind: "record", target: me.id, path: me.path },
        ...link,
      }));
      return links.length ? [{ record, links }] : [];
    })
    .sort((a, b) => (a.record.path < b.record.path ? -1 : 1));
  const backlinks = vi
    .spyOn(f.client, "backlinks")
    .mockImplementation(async (target, options = {}) => {
      expect(target).toEqual({ path: "people/Me.md" });
      const start = Number(options.cursor ?? 0);
      const page = referrers.slice(start, start + 2);
      return {
        backlinks: await Promise.all(
          page.map(async ({ record, links }) => ({
            record: await f.client.get(record.id),
            links,
          })),
        ),
        complete: true,
        asOf: 1,
        ...(start + 2 < referrers.length ? { cursor: String(start + 2) } : {}),
      };
    });
  const expected = assigned.map((record) => record.path).sort();
  const listed = await f.repository.listSummaries({
    assignedTo: "people/Me.md",
  });
  expect(listed.map((task) => task.path).sort()).toEqual(expected);
  const searched = await f.repository.search({
    search: "Task",
    assignedTo: "people/Me.md",
  });
  expect(searched.map(({ task }) => task.path).sort()).toEqual(expected);
  expect(backlinks).toHaveBeenCalledTimes(8);
});

it("treats a missing person record as having no assignments", async () => {
  const f = await fixture();
  await f.repository.create({ title: "Unassigned" });
  await expect(
    f.repository.listSummaries({ assignedTo: "people/Nobody.md" }),
  ).resolves.toEqual([]);
});
