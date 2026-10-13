import { expect, it, vi } from "vitest";
import { TaskMutations } from "./task-mutations";

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

it("flush waits for all current commands and detects commands started while flushing", async () => {
  const commands = new TaskMutations();
  let finishFirst!: () => void;
  let finishSecond!: () => void;
  let finishNew!: () => void;
  const firstWrite = new Promise<void>((resolve) => {
    finishFirst = resolve;
  });
  const secondWrite = new Promise<void>((resolve) => {
    finishSecond = resolve;
  });
  const newWrite = new Promise<void>((resolve) => {
    finishNew = resolve;
  });
  expect(commands.hasPending()).toBe(false);
  const first = commands.run("first", () => firstWrite);
  const second = commands.run("second", () => secondWrite);
  const flushed = vi.fn();
  const flushing = commands.flush().then(flushed);
  expect(commands.hasPending()).toBe(true);

  finishFirst();
  await first;
  expect(flushed).not.toHaveBeenCalled();
  expect(commands.hasPending()).toBe(true);

  const newer = commands.run("newer", () => newWrite);
  finishSecond();
  await second;
  await flushing;
  expect(flushed).toHaveBeenCalledOnce();
  // A reload must recheck after the captured batch, not ignore a newer edit.
  expect(commands.hasPending()).toBe(true);
  expect(commands.snapshot("newer").pending).toBe(true);
  finishNew();
  await newer;
  expect(commands.hasPending()).toBe(false);
});

it("flush rejects failed saves without losing the visible failure and allows retry", async () => {
  const commands = new TaskMutations();
  let fail!: (error: Error) => void;
  const write = new Promise<void>((_, reject) => {
    fail = reject;
  });
  const saving = commands.run("task", () => write, "save");
  const flushing = commands.flush();
  const saveFailure = expect(saving).rejects.toThrow("Save rejected");
  const flushFailure = expect(flushing).rejects.toThrow("Save rejected");
  fail(new Error("Save rejected"));
  await Promise.all([saveFailure, flushFailure]);
  expect(commands.hasPending()).toBe(false);
  expect(commands.snapshot("task").pending).toBe(false);
  expect(commands.snapshot("task").error?.message).toBe("Save rejected");

  await commands.run("task", async () => undefined, "save");
  await commands.flush();
  expect(commands.hasPending()).toBe(false);
  expect(commands.snapshot("task").error).toBeNull();
});
