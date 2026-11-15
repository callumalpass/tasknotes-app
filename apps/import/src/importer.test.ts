import { afterEach, beforeEach, it, expect, vi } from "vitest";
import {
  MdbaseClient,
  memoryWriteLedgerStore,
  type RecordView,
} from "@mdbase-dev/sdk";
import { MemoryReplica } from "@mdbase-dev/sdk/testing";
import {
  runImport,
  MdbaseTaskRepository,
  type ImportConnection,
} from "./storage/task-repository";
import { makePlan } from "./plan";
import { exampleSource, exampleTarget } from "./example";

it("accepts the narrow borrowed client without SDK instance identity", async () => {
  const records: ImportConnection = client;
  const repository = new MdbaseTaskRepository({
    records,
    isCurrent: () => true,
  });
  const plan = (await plans()).slice(0, 1);
  const report = await repository.importTasks(plan, () => {});
  expect(report).toEqual([
    expect.objectContaining({ sourceId: plan[0].sourceId, status: "created" }),
  ]);
});

it("never starts the next create after the borrowed app collection changes", async () => {
  let current = true;
  const repository = new MdbaseTaskRepository({
    records: client,
    isCurrent: () => current,
  });
  const create = vi.spyOn(client, "create");
  const progress = vi.fn((report) => {
    if (report.some((row: { status: string }) => row.status === "created"))
      current = false;
  });
  await expect(repository.importTasks(await plans(), progress)).rejects.toThrow(
    "destination changed",
  );
  expect(create).toHaveBeenCalledTimes(1);
  expect(progress).toHaveBeenLastCalledWith(
    expect.arrayContaining([expect.objectContaining({ status: "created" })]),
  );
});

it("refuses a stale repository before discovering or creating anything", async () => {
  const repository = new MdbaseTaskRepository({
    records: client,
    isCurrent: () => false,
  });
  const describe = vi.spyOn(client, "describe");
  const create = vi.spyOn(client, "create");
  await expect(repository.discoverTypes()).rejects.toThrow(
    "destination changed",
  );
  await expect(repository.importTasks(await plans(), () => {})).rejects.toThrow(
    "destination changed",
  );
  expect(describe).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
});

it("recovers and verifies the original create through the repository without submitting again", async () => {
  const plan = (await plans()).slice(0, 1);
  const report = await runImport(client, plan, () => {});
  const mutationId = report[0].mutationId!;
  const create = vi.spyOn(client, "create");
  const wait = vi.spyOn(client, "awaitReceipt");
  const progress = vi.fn();
  const repository = new MdbaseTaskRepository({
    records: client,
    isCurrent: () => true,
  });
  await repository.recoverWrites(
    [mutationId],
    plan,
    report.map((row) => ({ ...row, status: "uncertain" })),
    progress,
  );
  expect(wait).toHaveBeenCalledWith(mutationId, { timeoutMs: 30_000 });
  expect(progress).toHaveBeenLastCalledWith([
    expect.objectContaining({
      mutationId,
      status: "created",
      path: plan[0].path,
    }),
  ]);
  expect(create).not.toHaveBeenCalled();
});

it("keeps an unresolved original write uncertain and never creates a replacement", async () => {
  const mutationId = "original-pending-mutation";
  vi.spyOn(client, "awaitReceipt").mockResolvedValue({
    mutation: mutationId,
    state: "pending",
  });
  const create = vi.spyOn(client, "create");
  const progress = vi.fn();
  const repository = new MdbaseTaskRepository({
    records: client,
    isCurrent: () => true,
  });
  await expect(
    repository.recoverWrites([mutationId], await plans(), [], progress),
  ).rejects.toThrow("Write is pending");
  expect(progress).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
});

it("acknowledges only the rejected original mutation during recovery", async () => {
  const mutationId = "original-rejected-mutation";
  const plan = await plans();
  vi.spyOn(client, "awaitReceipt").mockResolvedValue({
    mutation: mutationId,
    state: "rejected",
  });
  const acknowledge = vi
    .spyOn(client.ledger, "acknowledge")
    .mockResolvedValue();
  const create = vi.spyOn(client, "create");
  const progress = vi.fn();
  const repository = new MdbaseTaskRepository({
    records: client,
    isCurrent: () => true,
  });
  await repository.recoverWrites(
    [mutationId],
    plan,
    [
      {
        sourceId: plan[0].sourceId,
        path: plan[0].path,
        status: "uncertain",
        mutationId,
      },
    ],
    progress,
  );
  expect(acknowledge).toHaveBeenCalledExactlyOnceWith(mutationId);
  expect(progress).toHaveBeenLastCalledWith([
    expect.objectContaining({ mutationId, status: "failed" }),
  ]);
  expect(create).not.toHaveBeenCalled();
});

it("refuses to mark an original write recovered when readback has another source identity", async () => {
  const plan = (await plans()).slice(0, 1);
  const report = await runImport(client, plan, () => {});
  const receipt = await client.awaitReceipt(report[0].mutationId!);
  const record = await client.get(receipt.records![0].id, {
    include: { body: true },
  });
  vi.spyOn(client, "get").mockResolvedValue({
    ...record,
    body: "Unrelated record",
  });
  const create = vi.spyOn(client, "create");
  const progress = vi.fn();
  const repository = new MdbaseTaskRepository({
    records: client,
    isCurrent: () => true,
  });
  await expect(
    repository.recoverWrites([report[0].mutationId!], plan, report, progress),
  ).rejects.toThrow("could not be verified");
  expect(progress).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
});

async function plans() {
  return makePlan(exampleSource, new Set(["brief", "review"]), exampleTarget, {
    folder: "tasks",
    dateTarget: "scheduled",
    priorities: { 1: "high", 3: "low" },
  });
}
let replica: MemoryReplica;
let client: MdbaseClient;
let ledgerStore: ReturnType<typeof memoryWriteLedgerStore>;
beforeEach(async () => {
  replica = new MemoryReplica({ confirmDelayMs: 0 });
  ledgerStore = memoryWriteLedgerStore();
  client = await MdbaseClient.connect({
    app: { name: "[test] TaskNotes Import", version: "test" },
    connector: replica.connector(),
    ledger: ledgerStore,
  });
  await vi.waitFor(() =>
    expect(client.ledger.getSnapshot().restored).toBe(true),
  );
});
afterEach(() => client.close());

it("creates confirmed native records, skips moved imports and skips everything on repeat", async () => {
  const plan = await plans();
  const scan = vi.spyOn(client, "pages");
  const read = vi.spyOn(client, "get");
  replica.seed({
    path: "moved/existing.md",
    types: ["task"],
    body: plan[0].body,
  });
  const create = vi.spyOn(client, "create");
  const progress = vi.fn();
  const report = await runImport(client, plan, progress);
  expect(report.map((r) => r.status)).toEqual(["skipped", "created"]);
  expect(report[0].path).toBe("moved/existing.md");
  expect(create).toHaveBeenCalledTimes(1);
  expect(report[1].mutationId).toBeTruthy();
  expect(scan).toHaveBeenCalledWith({}, { include: { body: true } });
  expect(read).toHaveBeenCalledWith(expect.any(String), {
    include: { body: true },
  });
  const record = await client.get(
    { path: plan[1].path },
    { include: { body: true } },
  );
  expect(record.body).toBe(plan[1].body);
  expect(record.state.state).toBe("confirmed");
  await vi.waitFor(() =>
    expect(client.ledger.getSnapshot().pending).toHaveLength(0),
  );
  const repeat = await runImport(client, plan, () => {});
  expect(repeat.map((r) => r.status)).toEqual(["skipped", "skipped"]);
  expect(create).toHaveBeenCalledTimes(1);
});
it("preflights all pages for collisions before the first write", async () => {
  const plan = await plans();
  for (let i = 0; i < 150; i++)
    replica.seed({ path: `other/${i}.md`, body: "Unrelated" });
  replica.seed({ path: plan[1].path, body: "An unrelated task" });
  const create = vi.spyOn(client, "create");
  await expect(runImport(client, plan, () => {})).rejects.toThrow(
    "unrelated record",
  );
  expect(create).not.toHaveBeenCalled();
});
it("refuses to start with pending native writes", async () => {
  replica.setOnline(false);
  await client.create({ path: "pending.md", body: "[test] pending" });
  const create = vi.spyOn(client, "create");
  await expect(runImport(client, await plans(), () => {})).rejects.toThrow(
    "needs recovery",
  );
  expect(create).not.toHaveBeenCalled();
});
it("refuses an unrestored ledger rather than ignoring earlier writes", async () => {
  vi.spyOn(client.ledger, "getSnapshot").mockReturnValue({
    pending: [],
    rejected: [],
    saveState: "saved",
    restored: false,
  });
  await expect(runImport(client, await plans(), () => {})).rejects.toThrow(
    "needs recovery",
  );
});
it("retains the SDK's original mutation ID when submission throws and never resubmits", async () => {
  const create = vi.spyOn(client, "create").mockRejectedValue(
    Object.assign(new Error("socket lost"), {
      mutationId: "original-mutation",
    }),
  );
  const report = await runImport(client, await plans(), () => {});
  expect(report.map((r) => r.status)).toEqual(["uncertain", "not-started"]);
  expect(report[0].mutationId).toBe("original-mutation");
  expect(create).toHaveBeenCalledTimes(1);
});
it("does not call an optimistic write created when confirmation is still pending", async () => {
  replica.setOnline(false);
  const wait = vi
    .spyOn(client, "awaitReceipt")
    .mockImplementation(async (mutation) => ({ mutation, state: "pending" }));
  const create = vi.spyOn(client, "create");
  const report = await runImport(client, await plans(), () => {});
  expect(report.map((r) => r.status)).toEqual(["uncertain", "not-started"]);
  expect(wait).toHaveBeenCalledWith(report[0].mutationId, {
    timeoutMs: 30_000,
  });
  expect(create).toHaveBeenCalledTimes(1);
  replica.setOnline(true);
  replica.confirmAll();
  wait.mockRestore();
  expect((await client.awaitReceipt(report[0].mutationId!)).state).toBe(
    "confirmed",
  );
  expect(create).toHaveBeenCalledTimes(1);
});
it("reports a rejected native receipt as failed, never created", async () => {
  replica.setOnline(false);
  vi.spyOn(client, "awaitReceipt").mockImplementation(async (mutation) => ({
    mutation,
    state: "rejected",
    problem: { code: "conflict", message: "Path taken", recovery: "refresh" },
  }));
  const report = await runImport(client, await plans(), () => {});
  expect(report.map((r) => r.status)).toEqual(["failed", "not-started"]);
});
it("keeps the original mutation when confirmed readback fails", async () => {
  vi.spyOn(client, "get").mockRejectedValue(new Error("readback unavailable"));
  const create = vi.spyOn(client, "create");
  const report = await runImport(client, await plans(), () => {});
  expect(report.map((r) => r.status)).toEqual(["uncertain", "not-started"]);
  expect((await client.receipt(report[0].mutationId!)).state).toBe("confirmed");
  expect(create).toHaveBeenCalledTimes(1);
});
it("honors cancellation between writes without cancelling a captured mutation", async () => {
  const cancel = new AbortController();
  const report = await runImport(
    client,
    await plans(),
    (rows) => {
      if (rows.some((r) => r.status === "created")) cancel.abort();
    },
    cancel.signal,
  );
  expect(report.map((r) => r.status)).toEqual(["created", "not-started"]);
});
it("does not submit any writes when cancelled before import starts", async () => {
  const cancel = new AbortController();
  cancel.abort();
  const create = vi.spyOn(client, "create");
  const report = await runImport(
    client,
    await plans(),
    () => {},
    cancel.signal,
  );
  expect(report.map((row) => row.status)).toEqual([
    "not-started",
    "not-started",
  ]);
  expect(create).not.toHaveBeenCalled();
});
it("settles a captured write after cancellation and never starts the next task", async () => {
  replica.setOnline(false);
  const cancel = new AbortController();
  const create = vi.spyOn(client, "create");
  const wait = vi.spyOn(client, "awaitReceipt");
  const progress = vi.fn();
  const importing = runImport(client, await plans(), progress, cancel.signal);
  await vi.waitFor(() => expect(wait).toHaveBeenCalledTimes(1));
  cancel.abort();
  expect(create).toHaveBeenCalledTimes(1);
  const mutationId = progress.mock.lastCall![0][0].mutationId;
  replica.setOnline(true);
  replica.confirmAll();
  const report = await importing;
  expect(report.map((row) => row.status)).toEqual(["created", "not-started"]);
  expect(report[0].mutationId).toBe(mutationId);
  expect((await client.receipt(mutationId)).state).toBe("confirmed");
  expect(create).toHaveBeenCalledTimes(1);
});
it("resumes a partially completed import without rewriting its confirmed task", async () => {
  const plan = await plans();
  const cancel = new AbortController();
  const create = vi.spyOn(client, "create");
  const first = await runImport(
    client,
    plan,
    (rows) => {
      if (rows.some((row) => row.status === "created")) cancel.abort();
    },
    cancel.signal,
  );
  expect(first.map((row) => row.status)).toEqual(["created", "not-started"]);
  const original = await client.get(
    { path: plan[0].path },
    { include: { body: true } },
  );
  await vi.waitFor(() =>
    expect(client.ledger.getSnapshot().pending).toHaveLength(0),
  );
  const resumed = await runImport(client, plan, () => {});
  expect(resumed.map((row) => row.status)).toEqual(["skipped", "created"]);
  expect(create).toHaveBeenCalledTimes(2);
  expect(
    await client.get({ path: plan[0].path }, { include: { body: true } }),
  ).toEqual(original);
});
it("does not overwrite a path occupied after the duplicate scan", async () => {
  const plan = await plans();
  const nativeCreate = client.create.bind(client);
  const create = vi.spyOn(client, "create").mockImplementationOnce((input) => {
    replica.seed({ path: input.path!, body: "[test] concurrent record" });
    return nativeCreate(input);
  });
  const report = await runImport(client, plan, () => {});
  expect(report[0].status).not.toBe("created");
  expect(report[1].status).toBe("not-started");
  expect(create).toHaveBeenCalledTimes(1);
  expect(
    (await client.get({ path: plan[0].path }, { include: { body: true } }))
      .body,
  ).toBe("[test] concurrent record");
});
it("recovers confirmed readback failure and resumes without replaying the write", async () => {
  const plan = await plans();
  const read = vi
    .spyOn(client, "get")
    .mockRejectedValueOnce(new Error("[test] interrupted readback"));
  const create = vi.spyOn(client, "create");
  const report = await runImport(client, plan, () => {});
  expect(report.map((row) => row.status)).toEqual(["uncertain", "not-started"]);
  expect(create).toHaveBeenCalledTimes(1);
  read.mockRestore();
  const progress = vi.fn();
  const repository = new MdbaseTaskRepository({
    records: client,
    isCurrent: () => true,
  });
  await repository.recoverWrites(
    [report[0].mutationId!],
    plan,
    report,
    progress,
  );
  expect(
    progress.mock.lastCall![0].map((row: { status: string }) => row.status),
  ).toEqual(["created", "not-started"]);
  expect(create).toHaveBeenCalledTimes(1);
  await vi.waitFor(() =>
    expect(client.ledger.getSnapshot().pending).toHaveLength(0),
  );
  const resumed = await repository.importTasks(plan, () => {});
  expect(resumed.map((row) => row.status)).toEqual(["skipped", "created"]);
  expect(create).toHaveBeenCalledTimes(2);
});
it("restores an interrupted import's original mutation after reopening the SDK client", async () => {
  const plan = await plans();
  replica.setOnline(false);
  const wait = vi
    .spyOn(client, "awaitReceipt")
    .mockImplementation(async (mutation) => ({ mutation, state: "pending" }));
  const report = await runImport(client, plan, () => {});
  const mutationId = report[0].mutationId!;
  expect(report.map((row) => row.status)).toEqual(["uncertain", "not-started"]);
  await vi.waitFor(async () =>
    expect(await ledgerStore.list()).toEqual([
      expect.objectContaining({ mutationId, state: "pending" }),
    ]),
  );
  wait.mockRestore();
  client.close();
  replica.setOnline(true);
  replica.confirmAll();
  client = await MdbaseClient.connect({
    app: { name: "[test] TaskNotes Import", version: "test" },
    connector: replica.connector(),
    ledger: ledgerStore,
  });
  await vi.waitFor(() =>
    expect(client.ledger.getSnapshot().restored).toBe(true),
  );
  const create = vi.spyOn(client, "create");
  const progress = vi.fn();
  const repository = new MdbaseTaskRepository({
    records: client,
    isCurrent: () => true,
  });
  await repository.recoverWrites([mutationId], plan, report, progress);
  expect(progress).toHaveBeenLastCalledWith([
    expect.objectContaining({ mutationId, status: "created" }),
    expect.objectContaining({ status: "not-started" }),
  ]);
  expect(create).not.toHaveBeenCalled();
  const receipt = await client.receipt(mutationId);
  expect(receipt.state).toBe("confirmed");
  expect(replica.allRecords).toHaveLength(1);
  expect(
    (await client.get(receipt.records![0].id, { include: { body: true } }))
      .body,
  ).toBe(plan[0].body);
});
it("does not import blocked conversions or duplicate source identities", async () => {
  const plan = await plans();
  const pages = vi.spyOn(client, "pages");
  plan[1].errors.push("unsupported");
  await expect(runImport(client, plan, () => {})).rejects.toThrow("blocked");
  await expect(runImport(client, [plan[0], plan[0]], () => {})).rejects.toThrow(
    "duplicate source",
  );
  expect(pages).not.toHaveBeenCalled();
});
it("fails closed if bodies are missing from native duplicate scans", async () => {
  const seeded = replica.seed({ path: "existing.md", body: "unrelated" });
  const record: RecordView = await client.get(seeded.id);
  delete record.body;
  vi.spyOn(client, "pages").mockImplementation(async function* () {
    yield { records: [record], complete: true, asOf: 1 };
  });
  const create = vi.spyOn(client, "create");
  await expect(runImport(client, await plans(), () => {})).rejects.toThrow(
    "record bodies",
  );
  expect(create).not.toHaveBeenCalled();
});
it("fails closed on incomplete pages without a continuation", async () => {
  vi.spyOn(client, "pages").mockImplementation(async function* () {
    yield { records: [], complete: false, asOf: 1 };
  });
  await expect(runImport(client, await plans(), () => {})).rejects.toThrow(
    "incomplete",
  );
});
it("never restarts a stale duplicate scan or writes after it", async () => {
  vi.spyOn(client, "pages").mockImplementation(async function* () {
    yield { records: [], complete: false, cursor: "first", asOf: 1 };
    throw new Error("cursor_stale");
  });
  const create = vi.spyOn(client, "create");
  await expect(runImport(client, await plans(), () => {})).rejects.toThrow(
    "cursor_stale",
  );
  expect(create).not.toHaveBeenCalled();
});
it("refuses duplicate imported identities in the destination", async () => {
  const plan = await plans();
  replica.seed({ path: "a.md", body: plan[0].body });
  replica.seed({ path: "b.md", body: plan[0].body });
  await expect(runImport(client, plan, () => {})).rejects.toThrow(
    "duplicate Todoist",
  );
});
