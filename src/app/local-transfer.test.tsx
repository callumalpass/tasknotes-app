import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "../test/render";
import { LocalTaskRepository } from "../storage/local-task-repository";
import { SnapshotTaskRepository } from "../storage/snapshot-task-repository";
import { TaskNotesTaskModel } from "../domain/tasknotes-model";
import { LocalTransferDialog } from "./local-transfer";

const owned: Array<{ local: LocalTaskRepository; name: string }> = [];
afterEach(async () => {
  for (const { local, name } of owned.splice(0)) {
    local.close();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Dexie.delete(name);
  }
});

it("reviews required custom values, retains failed writes, and checks the original identities on recovery", async () => {
  const name = `local-review-${crypto.randomUUID()}`;
  const local = new LocalTaskRepository(name);
  owned.push({ local, name });
  await local.initialize();
  await local.create({ title: "Before connecting" });
  const destination = new SnapshotTaskRepository();
  const configuration = await destination.taskConfiguration();
  configuration.userFields = [
    {
      id: "client",
      key: "client",
      displayName: "Client",
      type: "text",
      required: true,
    },
  ];
  const model = new TaskNotesTaskModel(configuration);
  const target = {
    typeName: "work",
    configuration,
    fingerprint: "current-definition",
  };
  const write = vi
    .fn()
    .mockRejectedValueOnce(new Error("connection interrupted"))
    .mockResolvedValue(undefined);
  const imports = {
    targets: async () => [target],
    prepareTask: async (
      task: import("../domain/task").Task,
      _choice: unknown,
      id: string,
    ) => {
      const imported = model.importTask(task, id);
      return {
        key: task.id,
        id,
        type: "work",
        path: imported.path,
        frontmatter: imported.frontmatter,
        body: imported.body,
      };
    },
    write,
  };
  // Browser Web Locks serialize the production path; jsdom runs its callback directly.
  Object.defineProperty(local, "exclusiveTransfer", {
    configurable: true,
    value: async (_destination: string, run: () => Promise<void>) => run(),
  });
  const view = render(
    <LocalTransferDialog
      local={local}
      destination={Object.assign(destination, { imports })}
      onClose={() => {}}
    />,
  );
  const transfer = await screen.findByRole("button", { name: "Transfer work" });
  expect(transfer).toBeDisabled();
  fireEvent.change(await screen.findByRole("textbox", { name: /Client/ }), {
    target: { value: "Example" },
  });
  expect(transfer).toBeEnabled();
  fireEvent.click(transfer);
  expect(await screen.findByRole("alert")).toHaveTextContent("Transfer paused");
  expect(
    write,
    screen.getByRole("alert").textContent ?? "transfer paused",
  ).toHaveBeenCalledOnce();
  const info = await destination.collectionInfo();
  const retained = await local.transfer(info.id!);
  expect(retained?.prepared[0]?.frontmatter.client).toBe("Example");
  expect(await local.list()).toHaveLength(1);
  view.unmount();
  render(
    <LocalTransferDialog
      local={local}
      destination={Object.assign(destination, { imports })}
      onClose={() => {}}
    />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Check transfer" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("Transfer complete"),
  );
  expect(write).toHaveBeenCalledTimes(2);
  expect(write.mock.calls[1]?.slice(0, 2)).toEqual(
    write.mock.calls[0]?.slice(0, 2),
  );
  expect(write.mock.calls[1]?.[2]).toBe(true);
  expect((await local.transferHistory(info.id!))[0]?.completed).toBe(true);
});
