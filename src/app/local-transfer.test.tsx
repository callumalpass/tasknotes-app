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
  expect(screen.getByRole("status")).toHaveTextContent("Copied 0 of 1");
  expect(
    write,
    screen.getByRole("alert").textContent ?? "transfer paused",
  ).toHaveBeenCalledOnce();
  const info = await destination.collectionInfo();
  const retained = await local.transfer(info.id!);
  expect(retained?.prepared[0]?.frontmatter.client).toBe("Example");
  expect(await local.list()).toHaveLength(1);
  view.unmount();
  const onClose = vi.fn();
  render(
    <LocalTransferDialog
      local={local}
      destination={Object.assign(destination, { imports })}
      onClose={onClose}
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
  // The completed state keeps one primary action, which closes the review.
  expect(
    screen.queryByRole("button", { name: "Close" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(onClose).toHaveBeenCalledOnce();
});

it("explains an empty review instead of offering a disabled transfer", async () => {
  const name = `local-review-${crypto.randomUUID()}`;
  const local = new LocalTaskRepository(name);
  owned.push({ local, name });
  await local.initialize();
  const destination = new SnapshotTaskRepository();
  const configuration = await destination.taskConfiguration();
  const target = { typeName: "task", configuration, fingerprint: "current" };
  render(
    <LocalTransferDialog
      local={local}
      destination={Object.assign(destination, {
        imports: {
          targets: async () => [target],
          prepareTask: vi.fn(),
          write: vi.fn(),
        },
      })}
      onClose={() => {}}
    />,
  );
  expect(
    await screen.findByText("There’s no new local work to bring in."),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Transfer work" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Close" })).toBeEnabled();
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
});

it("counts file confirmation in transfer progress, including a files-only import", async () => {
  const name = `local-review-files-${crypto.randomUUID()}`;
  const local = new LocalTaskRepository(name);
  owned.push({ local, name });
  await local.initialize();
  await local.files!.upload("Attachments/proof.txt", new Blob(["proof"]));
  Object.defineProperty(local, "exclusiveTransfer", {
    configurable: true,
    value: async (_destination: string, run: () => Promise<void>) => run(),
  });
  const destination = new SnapshotTaskRepository();
  const configuration = await destination.taskConfiguration();
  vi.spyOn(destination.files!, "upload").mockRejectedValueOnce(
    new Error("connection interrupted"),
  );
  render(
    <LocalTransferDialog
      local={local}
      destination={Object.assign(destination, {
        imports: {
          targets: async () => [
            { typeName: "task", configuration, fingerprint: "current" },
          ],
          prepareTask: vi.fn(),
          write: vi.fn(),
        },
      })}
      onClose={() => {}}
    />,
  );
  const transfer = await screen.findByRole("button", { name: "Transfer work" });
  await waitFor(() => expect(transfer).toBeEnabled());
  fireEvent.click(transfer);
  expect(await screen.findByRole("alert")).toHaveTextContent("Transfer paused");
  expect(screen.getByRole("status")).toHaveTextContent("Copied 0 of 1");
});
