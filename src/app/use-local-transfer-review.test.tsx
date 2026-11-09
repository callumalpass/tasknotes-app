import Dexie from "dexie";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "../test/render";
import { deferred } from "../test/deferred";
import { LocalTaskRepository } from "../storage/local-task-repository";
import { SnapshotTaskRepository } from "../storage/snapshot-task-repository";
import { TaskNotesTaskModel } from "../domain/tasknotes-model";
import { resolveTaskCollectionConfiguration } from "../domain/task-configuration";
import {
  executeTransfer,
  prepareTransfer,
  suggestTransferPlan,
} from "../application/local-transfer";
import type { CollectionSnapshot } from "../application/ports/local-collection";
import type { TaskImportPort } from "../application/ports/task-import";
import { useLocalTransferReview } from "./use-local-transfer-review";

type Local = Parameters<typeof useLocalTransferReview>[0];
function Prompt({
  local,
  destination,
}: {
  local: Local;
  destination?: string;
}) {
  const needed = useLocalTransferReview(local, destination);
  return needed ? <button>Review local tasks</button> : null;
}

const owned: Array<{ local: LocalTaskRepository; name: string }> = [];
afterEach(async () => {
  cleanup();
  for (const { local, name } of owned.splice(0)) {
    local.close();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Dexie.delete(name);
  }
});

it("hides the prompt only after the last import is confirmed, and restores it for new or edited local work", async () => {
  const name = `review-visibility-${crypto.randomUUID()}`;
  const local = new LocalTaskRepository(name);
  owned.push({ local, name });
  await local.initialize();
  const first = await local.create({
    title: "First",
    body: "Keep these notes",
  });
  await local.create({ title: "Second" });
  const snapshot = await local.exportSnapshot();
  const model = new TaskNotesTaskModel(
    resolveTaskCollectionConfiguration(snapshot.modelDefinition),
  );
  const target = {
    typeName: "task",
    configuration: model.configuration(),
    fingerprint: "definition",
  };
  const lastWrite = deferred<void>();
  const write = vi
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockReturnValueOnce(lastWrite.promise);
  const port: TaskImportPort = {
    targets: async () => [target],
    prepareTask: async (task, choice, id) => {
      const imported = model.importTask(task, id);
      return {
        key: task.id,
        id,
        path: imported.path,
        type: choice.typeName,
        frontmatter: imported.frontmatter,
        body: imported.body,
      };
    },
    write,
  };
  const view = render(<Prompt local={local} destination="A" />);
  expect(
    await screen.findByRole("button", { name: "Review local tasks" }),
  ).toBeVisible();
  const ledger = await prepareTransfer(
    snapshot,
    "A",
    suggestTransferPlan(snapshot, target),
    port,
  );
  await act(() => local.saveTransfer(ledger));
  let execution!: Promise<void>;
  await act(async () => {
    execution = executeTransfer(ledger, port, local.files, (next) =>
      local.saveTransfer(next),
    );
  });
  await waitFor(() => expect(write).toHaveBeenCalledTimes(2));
  expect(ledger.records[first.id]!.confirmed).toBe(true);
  expect(
    screen.getByRole("button", { name: "Review local tasks" }),
  ).toBeVisible();
  await act(async () => {
    lastWrite.resolve();
    await execution;
  });
  await waitFor(() => expect(screen.queryByRole("button")).toBeNull());
  // Recovery data is retained. A reload uses the same completed history.
  expect(await local.list()).toHaveLength(2);
  expect((await local.get(first.id))!.body).toBe("Keep these notes");
  view.unmount();
  const reopened = render(<Prompt local={local} destination="A" />);
  await act(() => local.refresh());
  expect(screen.queryByRole("button")).toBeNull();
  await act(() => local.update(first.id, { body: "Changed after import" }));
  expect(
    await screen.findByRole("button", { name: "Review local tasks" }),
  ).toBeVisible();
  // Another destination still needs its own reviewed import.
  reopened.rerender(<Prompt local={local} destination="B" />);
  expect(
    await screen.findByRole("button", { name: "Review local tasks" }),
  ).toBeVisible();
  reopened.rerender(<Prompt local={local} destination="A" />);
  await act(() => local.update(first.id, { body: first.body }));
  await waitFor(() => expect(screen.queryByRole("button")).toBeNull());
  await act(() => local.create({ title: "New local capture" }));
  expect(
    await screen.findByRole("button", { name: "Review local tasks" }),
  ).toBeVisible();
});

it("keeps an unfinished import actionable even when its source items have been removed locally", async () => {
  const source = new SnapshotTaskRepository();
  await source.initialize();
  const snapshot = source.snapshot();
  const local: Local = {
    exportSnapshot: async () => snapshot,
    transfer: async () => ({ completed: false }) as never,
    transferHistory: async () => [],
    subscribe: () => () => {},
  };
  render(<Prompt local={local} destination="A" />);
  expect(
    await screen.findByRole("button", { name: "Review local tasks" }),
  ).toBeVisible();
});

it("ignores a delayed older read and never carries a prompt into a different destination", async () => {
  const source = new SnapshotTaskRepository();
  await source.create({ title: "Previously pending" });
  const oldRead = deferred<CollectionSnapshot>();
  const empty = new SnapshotTaskRepository().snapshot();
  let changed!: () => void;
  const local: Local = {
    exportSnapshot: vi
      .fn()
      .mockReturnValueOnce(oldRead.promise)
      .mockResolvedValue(empty),
    transfer: async () => undefined,
    transferHistory: async () => [],
    subscribe: (listener) => {
      changed = listener;
      return () => {};
    },
  };
  const view = render(<Prompt local={local} destination="A" />);
  await act(async () => {
    changed();
  });
  await act(async () => {
    oldRead.resolve(source.snapshot());
  });
  expect(screen.queryByRole("button")).toBeNull();
  const readForA = deferred<CollectionSnapshot>();
  vi.mocked(local.exportSnapshot).mockReturnValueOnce(readForA.promise);
  await act(async () => {
    changed();
  });
  view.rerender(<Prompt local={local} destination="B" />);
  await act(async () => {
    readForA.resolve(source.snapshot());
  });
  expect(screen.queryByRole("button")).toBeNull();
  view.rerender(<Prompt local={local} />);
  expect(screen.queryByRole("button")).toBeNull();
});
