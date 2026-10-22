import {
  type MdbaseClient,
  type MdbasePeopleClient,
  type PeopleDirectory as NativePeopleDirectory,
  type wire,
} from "@mdbase-dev/sdk";
import { nextTaskFixture } from "../test/next-task-fixture";
import { defaultTaskCollectionConfiguration } from "../domain/task-configuration";
import { NextTaskRepository } from "./next-repository";

// Original SDK CRUD/helper code, synthetic native projection/People port DTOs.
// Not native CEL, account/authority bridge or LAB admission qualification.
const fixtures: Awaited<ReturnType<typeof nextTaskFixture>>[] = [];
const borrowed: NextTaskRepository[] = [];
afterEach(() => {
  borrowed.splice(0).forEach((repository) => repository.dispose());
  fixtures.splice(0).forEach((fixture) => fixture.close());
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
function directory(): NativePeopleDirectory {
  const identity = { issuer: "https://identity.example", subject: "opaque" };
  const person = {
    id: "20000000-0000-4000-8000-000000000002",
    path: "people/Alex.md",
    name: "Alex Rivera",
    identities: [identity],
    typeNames: ["person"],
  };
  return {
    account: {
      ...identity,
      name: "Current account",
      personSettingsUrl: "https://connect.example/settings#your-person",
    },
    me: { status: "linked", person },
    people: [person],
    invalid: [],
    members: [{ ...identity, name: "Alex", role: "owner" }],
  };
}

it("borrows the supplied SDK People port, preserves its display resolution and asks for optional membership only", async () => {
  const f = await fixture();
  const read = vi
    .fn<MdbasePeopleClient["directory"]>()
    .mockResolvedValue(directory());
  const repository = new NextTaskRepository(f.client, "Tasks", f.accountId, {
    clientOwnership: "borrowed",
    peopleClient: { directory: read },
  });
  borrowed.push(repository);
  const controller = new AbortController();
  const result = await repository.people(controller.signal);
  expect(read).toHaveBeenCalledOnce();
  expect(read).toHaveBeenCalledWith({
    signal: expect.any(AbortSignal),
    members: "if-approved",
  });
  expect(result).toEqual({
    current: { status: "linked", personPath: "people/Alex.md" },
    settingsUrl: "https://connect.example/settings#your-person",
    people: [
      {
        name: "Alex Rivera",
        path: "people/Alex.md",
        activeMember: true,
        ambiguousIdentity: false,
      },
    ],
  });
  controller.abort();
  expect(read.mock.calls[0]![0]!.signal!.aborted).toBe(true);
});

it("reports missing People authority instead of inventing an empty or unlinked directory", async () => {
  const f = await fixture();
  await expect(f.repository.people()).rejects.toMatchObject({
    reason: "unsupported",
  });
});

async function assignmentFixture() {
  const f = await fixture();
  const raw = [
    "[[Alex|Teammate]]",
    "[Other Alex](elsewhere/Alex.md)",
    "[[Nobody]]",
    "[[Ambiguous]]",
  ];
  const task = await f.repository.create({
    title: "Assigned task",
    assignees: raw,
  });
  const records: wire.RecordView[] = [];
  for await (const page of f.client.pages({ types: ["task"] }))
    records.push(...page.records);
  const original = records.find((record) => record.path === task.path)!;
  const projection: wire.QueryResult = {
    records: [
      {
        ...original,
        values: new Map<string, (string | null)[]>([
          ["raw", raw],
          ["paths", ["people/Alex.md", "elsewhere/Alex.md", null, null]],
        ]),
      },
    ],
    columns: ["raw", "paths"],
    asOf: 1,
    complete: true,
  };
  return { f, raw, task, projection };
}

function mockProjection(
  f: Awaited<ReturnType<typeof fixture>>,
  read: MdbaseClient["query"],
) {
  const original = f.client.query.bind(f.client);
  const projection = vi.fn(read);
  vi.spyOn(f.client, "query").mockImplementation(
    (query, include, signal, options) => {
      const selected =
        Array.isArray(query.select) &&
        query.select.some(
          (column) =>
            column !== null &&
            typeof column === "object" &&
            "name" in column &&
            column.name === "paths",
        );
      return selected
        ? projection(query, include, signal, options)
        : original(query, include, signal, options);
    },
  );
  return projection;
}

it("resolves aliases and same-basename assignments only through the SDK's mapped native projection", async () => {
  const { f, raw, task, projection } = await assignmentFixture();
  const query = mockProjection(f, async () => projection);
  expect(await f.repository.resolveAssignees(task.id)).toEqual(
    new Map([
      [raw[0]!, "people/Alex.md"],
      [raw[1]!, "elsewhere/Alex.md"],
      [raw[2]!, null],
      [raw[3]!, null],
    ]),
  );
  expect(query).toHaveBeenCalledOnce();
  expect(query.mock.calls[0]![0]).toMatchObject({
    where: `file.path == ${JSON.stringify(task.path)}`,
    limit: 2,
  });
  const select = query.mock.calls[0]![0].select as {
    name: string;
    expr: string;
  }[];
  expect(select.map((column) => column.name)).toEqual(["raw", "paths"]);
  expect(select.every((column) => column.expr.includes('"owners"'))).toBe(true);
  expect(select.some((column) => column.expr.includes('"assignees"'))).toBe(
    false,
  );
});

it.each(["unsupported", "incomplete"] as const)(
  "refuses %s native link projections rather than guessing saved targets",
  async (kind) => {
    const { f, task, projection } = await assignmentFixture();
    mockProjection(f, async () =>
      kind === "unsupported"
        ? { records: projection.records, asOf: projection.asOf, complete: true }
        : { ...projection, complete: false },
    );
    await expect(f.repository.resolveAssignees(task.id)).rejects.toMatchObject({
      reason:
        kind === "unsupported"
          ? "record_links_unsupported"
          : "record_links_response",
    });
  },
);

it("rejects a late projection after the task generation changes", async () => {
  const { f, task, projection } = await assignmentFixture();
  let finish!: (projection: wire.QueryResult) => void;
  const query = mockProjection(
    f,
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = f.repository.resolveAssignees(task.id);
  await vi.waitFor(() => expect(query).toHaveBeenCalledOnce());
  await f.repository.update(task.id, { assignees: ["[[New person]]"] });
  finish(projection);
  await expect(pending).rejects.toMatchObject({
    reason: "record_links_fenced",
  });
});

it("never publishes targets after the original caller cancels", async () => {
  const { f, task, projection } = await assignmentFixture();
  let finish!: (projection: wire.QueryResult) => void;
  const query = mockProjection(
    f,
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const controller = new AbortController();
  const pending = f.repository.resolveAssignees(task.id, controller.signal);
  await vi.waitFor(() => expect(query).toHaveBeenCalledOnce());
  controller.abort();
  finish(projection);
  await expect(pending).rejects.toThrow();
  expect(query.mock.calls[0]![2]!.aborted).toBe(true);
});
