/** LOCAL TEST caller predicates. Invoke only with the owned actual native
 * facade. Compiling these predicates or using SDK stand-ins is NOT native proof. */
import type { MdbaseClient } from "@mdbase-dev/sdk";
import type { Task } from "../src/domain/task";
import type { NextTaskRepository } from "../src/storage/next-repository";
import { findOccurrenceParent } from "../src/domain/task-occurrence";
import { ensureTaskNotesDefaultViewSource } from "../src/application/ensure-default-view-source";

const check: (value: unknown, message: string) => asserts value = (
  value,
  message,
) => {
  if (!value) throw Error(`owned native TaskNotes callers: ${message}`);
};

export async function qualifyNativeTaskNotesLocalCallers(options: {
  repository: NextTaskRepository;
  client: MdbaseClient;
  taskId: string;
  submitted: string[];
  capture<T>(promise: Promise<T>): Promise<T>;
  confirm(mutation: string): Promise<void>;
}) {
  const { repository, client, taskId, submitted, capture, confirm } = options;
  async function record(action: () => Promise<Task>) {
    const before = submitted.length;
    const task = await capture(action());
    check(
      submitted.length === before + 1,
      "caller did not capture exactly one MID",
    );
    const mutation = submitted[before]!;
    const pending = (
      await client.pendingWrites(AbortSignal.timeout(5000))
    ).find((write) => write.receipt.mutation === mutation);
    const native = await client.get(
      { path: task.path },
      { body: true, document: true, effective: true },
      AbortSignal.timeout(5000),
    );
    check(
      pending?.receipt.state === "pending" &&
        native.path === task.path &&
        native.body === task.body &&
        typeof native.document === "string" &&
        native.state.state === "pending" &&
        Number.isSafeInteger(native.state.confirmedSeq) &&
        native.state.confirmedSeq >= 0 &&
        !native.state.hold &&
        !native.state.unresolved &&
        repository.writeState({ kind: "task", id: task.id }) === "pending",
      "caller lacks genuine unprotected pending native READ/original MID",
    );
    return { task, native, pending, mutation, before };
  }
  async function acknowledge(captured: Awaited<ReturnType<typeof record>>) {
    await confirm(captured.mutation);
    const native = await client.get(
      captured.native.id,
      { body: true, document: true, effective: true },
      AbortSignal.timeout(5000),
    );
    const task = await repository.get(captured.task.id);
    check(
      native.id === captured.native.id &&
        native.path === captured.native.path &&
        native.state.state === "confirmed" &&
        task?.id === captured.task.id &&
        task.path === captured.task.path &&
        task.title === captured.task.title &&
        task.body === captured.task.body &&
        submitted.length === captured.before + 1,
      "ACK changed native/portable/path witnesses or replaced the submission",
    );
  }

  const initial = await repository.get(taskId);
  check(
    initial && initial.timeEntries.length === 0,
    "fresh time-field fixture is not empty",
  );
  const started = await record(() =>
    repository.startTimeTracking(taskId, "Native timer"),
  );
  check(
    started.task.timeEntries.length === 1 &&
      started.task.timeEntries[0]?.description === "Native timer" &&
      !started.task.timeEntries[0]?.endTime,
    "native time start was not read back",
  );
  await acknowledge(started);
  const stopped = await record(() => repository.stopTimeTracking(taskId));
  check(
    stopped.task.timeEntries.length === 1 &&
      stopped.task.timeEntries[0]?.endTime,
    "native time stop was not read back",
  );
  await acknowledge(stopped);
  const entry = {
    startTime: "2026-08-05T10:00:00.000Z",
    endTime: "2026-08-05T10:15:00.000Z",
    description: "Native replacement",
  };
  const replaced = await record(() =>
    repository.replaceTimeEntries(taskId, [entry]),
  );
  check(
    replaced.task.timeEntries.length === 1 &&
      replaced.task.timeEntries[0]?.description === entry.description &&
      Date.parse(replaced.task.timeEntries[0]!.startTime) ===
        Date.parse(entry.startTime) &&
      Date.parse(replaced.task.timeEntries[0]!.endTime!) ===
        Date.parse(entry.endTime),
    "native replacement time fields differ from original operation",
  );
  await acknowledge(replaced);
  const removed = await record(() => repository.removeTimeEntry(taskId, 0));
  check(
    removed.task.timeEntries.length === 0,
    "native time-entry deletion was not read back",
  );
  await acknowledge(removed);

  const today = new Date().toISOString().slice(0, 10);
  const parent = await record(() =>
    repository.create({
      title: "Native rolling caller",
      scheduled: today,
      recurrence: `FREQ=DAILY;COUNT=3;DTSTART=${today.replaceAll("-", "")}`,
      occurrenceMaterialization: "rolling",
      occurrencePastHorizon: "P7D",
      occurrenceFutureHorizon: "P7D",
    }),
  );
  check(
    parent.pending.ops.length === 4 &&
      parent.pending.ops.every((op) => op.kind === "create"),
    "rolling parent/three children were not one original native batch",
  );
  const children = (await repository.listSummaries()).filter(
    (task) => findOccurrenceParent([parent.task], task)?.id === parent.task.id,
  );
  check(
    children.length === 3 &&
      new Set(children.map((task) => task.path)).size === 3 &&
      new Set(children.map((task) => task.occurrenceDate)).size === 3,
    "rolling children are missing, partial or duplicated",
  );
  const witnesses = await Promise.all(
    children.map((task) =>
      client.get(
        { path: task.path },
        { document: true, effective: true },
        AbortSignal.timeout(5000),
      ),
    ),
  );
  check(
    witnesses.every(
      (native) =>
        native.state.state === "pending" &&
        !native.state.hold &&
        !native.state.unresolved &&
        typeof native.document === "string",
    ),
    "atomic children lack genuine pending native documents",
  );
  await acknowledge(parent);
  const renamed = await record(() =>
    repository.update(parent.task.id, { title: "Native rolling renamed" }),
  );
  check(
    renamed.pending.ops.length === 1 &&
      renamed.pending.ops[0]?.kind === "update",
    "same rolling window recreated children",
  );
  await acknowledge(renamed);
  const beforeDuplicate = submitted.length;
  const duplicate = await repository.materializeOccurrence(
    parent.task.id,
    children[0]!.occurrenceDate!,
  );
  check(
    !duplicate.created &&
      duplicate.task.id === children[0]!.id &&
      duplicate.task.path === children[0]!.path &&
      submitted.length === beforeDuplicate,
    "existing occurrence was reminted or replacement-submitted",
  );
  for (let i = 0; i < witnesses.length; i++) {
    const native = await client.get(
      witnesses[i]!.id,
      { document: true, effective: true },
      AbortSignal.timeout(5000),
    );
    check(
      native.id === witnesses[i]!.id &&
        native.path === witnesses[i]!.path &&
        native.document === witnesses[i]!.document &&
        native.state.state === "confirmed",
      "rolling child witness changed after ACK/dedupe",
    );
  }

  const documents = await repository.listViews();
  const configuration = await repository.taskConfiguration();
  const beforeDefaults = submitted.length;
  const defaults = await ensureTaskNotesDefaultViewSource(
    repository,
    documents,
    configuration,
  );
  check(
    repository.defaultViewSourceCreation === "explicit-only" &&
      defaults === documents &&
      submitted.length === beforeDefaults,
    "navigation automatically seeded native defaults",
  );
  return {
    nativeTimeFieldCallers: true,
    nativeAtomicRollingCaller: true,
    nativeRollingDedupe: true,
    nativeDefaultsRemainExplicit: true,
  };
}
