import { expect, it, vi } from "vitest";
import { TaskMutations } from "./task-mutations";
import { DemoTaskRepository } from "../demo/demo-task-repository";

it("joins repeated completion intent, exposes rejection, and supports retry", async () => {
  const commands = new TaskMutations();
  let reject!: (error: Error) => void;
  const write = vi.fn(
    () =>
      new Promise<void>((_, fail) => {
        reject = fail;
      }),
  );
  const first = commands.run("task", write, "complete:true");
  const duplicate = commands.run("task", write, "complete:true");
  expect(first).toBe(duplicate);
  expect(commands.snapshot("task").pending).toBe(true);
  await Promise.resolve();
  reject(new Error("Offline"));
  await expect(first).rejects.toThrow("Offline");
  expect(write).toHaveBeenCalledOnce();
  expect(commands.snapshot("task").error?.message).toBe("Offline");
  await commands.run("task", async () => undefined, "complete:true");
  expect(commands.snapshot("task").error).toBeNull();
});

it("queues different intent rather than reporting it accepted without writing", async () => {
  const commands = new TaskMutations();
  const history: boolean[] = [];
  let release!: () => void;
  const first = commands.run(
    "task",
    async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      history.push(true);
    },
    "true",
  );
  const next = commands.run(
    "task",
    async () => {
      history.push(false);
    },
    "false",
  );
  await Promise.resolve();
  expect(history).toEqual([]);
  release();
  await Promise.all([first, next]);
  expect(history).toEqual([true, false]);
});

it("does not join an earlier intent across a queued opposite intent", async () => {
  const commands = new TaskMutations();
  const history: boolean[] = [];
  const states: boolean[] = [];
  commands.subscribe("task", () =>
    states.push(commands.snapshot("task").pending),
  );
  const first = commands.run(
    "task",
    async () => {
      history.push(true);
    },
    "true",
  );
  const second = commands.run(
    "task",
    async () => {
      history.push(false);
    },
    "false",
  );
  const third = commands.run(
    "task",
    async () => {
      history.push(true);
    },
    "true",
  );
  expect(third).not.toBe(first);
  await Promise.all([first, second, third]);
  expect(history).toEqual([true, false, true]);
  expect(states.slice(0, -1).every(Boolean)).toBe(true);
  expect(states.at(-1)).toBe(false);
});

it("desired completion is idempotent for ordinary and recurring tasks", async () => {
  const repository = new DemoTaskRepository();
  await repository.initialize();
  const ordinary = await repository.create({ title: "Repeated completion" });
  await repository.toggle(ordinary.id, undefined, true);
  expect(
    (await repository.toggle(ordinary.id, undefined, true)).completed,
  ).toBe(true);
  const recurring = await repository.create({
    title: "Recurring completion",
    recurrence: "FREQ=DAILY",
  });
  await repository.toggle(recurring.id, "2026-09-09", true);
  expect(
    (await repository.toggle(recurring.id, "2026-09-09", true))
      .completeInstances,
  ).toContain("2026-09-09");
});
