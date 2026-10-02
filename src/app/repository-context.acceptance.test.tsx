import { act, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { DemoTaskRepository } from "../demo/demo-task-repository";
import { AutoArchiveActivity } from "../application/auto-archive-activity";
import { syncTaskNotifications } from "../native/notifications";
import { MemoryMutationJournal } from "../test/memory-mutation-journal";
import { RepositoryProvider, useRepository } from "./repository-context";

vi.mock("../native/notifications", async (load) => ({
  ...(await load<typeof import("../native/notifications")>()),
  syncTaskNotifications: vi.fn(async () => undefined),
  reconcileTaskNotifications: vi.fn(async () => undefined),
}));

type Commands = ReturnType<typeof useRepository>;
const commands: [
  string,
  (context: Commands, id: string) => Promise<unknown>,
][] = [
  ["create", (c) => c.createTask({ title: "Accepted" })],
  ["update", (c, id) => c.updateTask(id, { status: "done" })],
  [
    "bulk update",
    (c, id) => c.updateTasks([{ id, input: { status: "done" } }]),
  ],
  ["complete", (c, id) => c.setTaskCompletion({ id, completed: true })],
  ["skip", (c, id) => c.skipTask(id, "2026-10-02")],
  ["materialize", (c, id) => c.materializeOccurrence(id, "2026-10-02")],
  ["start time", (c, id) => c.startTimeTracking(id)],
  ["stop time", (c, id) => c.stopTimeTracking(id)],
  ["replace time", (c, id) => c.replaceTimeEntries(id, [])],
  ["remove time", (c, id) => c.removeTimeEntry(id, 0)],
  ["archive", (c, id) => c.setTaskArchived(id, true)],
];

it.each(commands)(
  "keeps accepted %s successful when scheduling fails",
  async (_name, command) => {
    const repository = new DemoTaskRepository(1);
    const task = await repository.create({ title: "Accepted" });
    // Only the primary authority call is stubbed; exercise real provider command wiring.
    for (const method of [
      "create",
      "update",
      "toggle",
      "skip",
      "startTimeTracking",
      "stopTimeTracking",
      "replaceTimeEntries",
      "removeTimeEntry",
      "setArchived",
    ] as const)
      vi.spyOn(repository, method).mockResolvedValue(task);
    vi.spyOn(repository, "updateMany").mockResolvedValue([task]);
    vi.spyOn(repository, "materializeOccurrence").mockResolvedValue({
      task,
      warnings: [],
      created: true,
    });
    vi.spyOn(AutoArchiveActivity.prototype, "observe").mockRejectedValue(
      new Error("Schedule failed"),
    );
    let context!: Commands;
    function Probe() {
      context = useRepository();
      return <p>{context.status}</p>;
    }
    render(
      <RepositoryProvider
        repository={repository}
        reminderAuthority="connect"
        mutationJournal={new MemoryMutationJournal()}
      >
        <Probe />
      </RepositoryProvider>,
    );
    await screen.findByText("ready");
    let result: unknown;
    await act(async () => {
      result = await command(context, task.id);
    });
    const accepted = Array.isArray(result)
      ? result[0]
      : result && typeof result === "object" && "task" in result
        ? result.task
        : result;
    expect(accepted).toMatchObject({
      id: task.id,
      operationWarnings: [expect.stringContaining("Schedule failed")],
    });
  },
);

it.each(["delete", "settings"])(
  "does not reject accepted %s when archive maintenance fails",
  async (command) => {
    const repository = new DemoTaskRepository(1);
    const task = await repository.create({ title: "Accepted" });
    let context!: Commands;
    function Probe() {
      context = useRepository();
      return <p>{context.status}</p>;
    }
    render(
      <RepositoryProvider
        repository={repository}
        mutationJournal={new MemoryMutationJournal()}
      >
        <Probe />
      </RepositoryProvider>,
    );
    await screen.findByText("ready");
    vi.spyOn(AutoArchiveActivity.prototype, "forget").mockRejectedValue(
      new Error("Forget failed"),
    );
    vi.spyOn(AutoArchiveActivity.prototype, "reconcile").mockRejectedValue(
      new Error("Reconcile failed"),
    );
    await act(async () => {
      if (command === "delete") {
        await context.deleteTask(task.id);
        await context.retryTaskDeletion();
      } else await context.updateTaskModelSettings({ defaultPriority: "high" });
    });
    if (command === "delete") {
      expect(await repository.getSummary(task.id)).toBeNull();
      expect(context.pendingDeletion).toBeNull();
      expect(context.deletionError).toBeNull();
    } else expect(context.configuration.defaults.priority).toBe("high");
  },
);

it("still rejects a primary failure before acceptance", async () => {
  const repository = new DemoTaskRepository(1);
  const observe = vi.spyOn(AutoArchiveActivity.prototype, "observe");
  vi.spyOn(repository, "create").mockRejectedValue(
    new Error("Authority unavailable"),
  );
  let context!: Commands;
  function Probe() {
    context = useRepository();
    return <p>{context.status}</p>;
  }
  render(
    <RepositoryProvider
      repository={repository}
      mutationJournal={new MemoryMutationJournal()}
    >
      <Probe />
    </RepositoryProvider>,
  );
  await screen.findByText("ready");
  await expect(context.createTask({ title: "Not accepted" })).rejects.toThrow(
    "Authority unavailable",
  );
  expect(observe).not.toHaveBeenCalled();
});

it("reports background reminder failure without rejecting an accepted write", async () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  const repository = new DemoTaskRepository(1);
  vi.mocked(syncTaskNotifications).mockRejectedValueOnce(
    new Error("Reminder failed"),
  );
  let context!: Commands;
  function Probe() {
    context = useRepository();
    return <p>{context.status}</p>;
  }
  render(
    <RepositoryProvider
      repository={repository}
      reminderAuthority="connect"
      mutationJournal={new MemoryMutationJournal()}
    >
      <Probe />
    </RepositoryProvider>,
  );
  await screen.findByText("ready");
  let task;
  await act(async () => {
    task = await context.createTask({ title: "Saved" });
  });
  expect(task).toMatchObject({ title: "Saved" });
  expect(warning).toHaveBeenCalledWith(
    expect.stringContaining("Reminder failed"),
    expect.any(Error),
  );
});
