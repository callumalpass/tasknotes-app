import { expect, it, vi } from "vitest";
import type { Task } from "../domain/task";
import {
  AcceptedTaskEffects,
  acceptedWriteEffect,
} from "./accepted-task-effects";

const saved = {
  id: "saved",
  title: "Accepted",
  operationWarnings: ["Earlier warning"],
} as Task;

function fixture() {
  const effects = {
    invalidate: vi.fn(),
    observe: vi.fn(async () => undefined),
    forget: vi.fn(async () => undefined),
    notify: vi.fn(async () => undefined),
    removeNotifications: vi.fn(async () => undefined),
    affectsNotifications: vi.fn(() => true),
  };
  return { effects, accepted: new AcceptedTaskEffects(effects) };
}

it("shares the accepted policy between single and bulk updates", async () => {
  const { effects, accepted } = fixture();
  effects.observe.mockRejectedValue(new Error("Schedule failed"));
  const tasks = await accepted.updated(
    [saved],
    [{ id: saved.id, input: { status: "done" } }],
  );
  expect(tasks[0]?.operationWarnings).toEqual([
    "Earlier warning",
    expect.stringContaining("Schedule failed"),
  ]);
  expect(effects.invalidate).toHaveBeenCalledWith([saved.id]);
  expect(effects.notify).toHaveBeenCalledWith(saved);
});

it("continues other accepted effects when invalidation fails", async () => {
  const { effects, accepted } = fixture();
  effects.invalidate.mockImplementation(() => {
    throw new Error("View failed");
  });
  const task = await accepted.task(saved);
  expect(task.operationWarnings).toEqual([
    "Earlier warning",
    expect.stringContaining("View failed"),
  ]);
  expect(effects.observe).toHaveBeenCalledWith(saved);
  expect(effects.notify).toHaveBeenCalledWith(saved);
});

it("avoids irrelevant archive and reminder work without changing acceptance", async () => {
  const { effects, accepted } = fixture();
  effects.affectsNotifications.mockReturnValue(false);
  expect(await accepted.task(saved, { input: { title: "Title" } })).toBe(saved);
  expect(effects.observe).not.toHaveBeenCalled();
  expect(effects.notify).not.toHaveBeenCalled();
  await accepted.task(saved, { notify: false });
  expect(effects.observe).toHaveBeenCalledWith(saved);
  expect(effects.notify).not.toHaveBeenCalled();
});

it("reports failed deletion follow-up and still invalidates and clears reminders", async () => {
  const { effects, accepted } = fixture();
  effects.forget.mockRejectedValue(new Error("Forget failed"));
  effects.removeNotifications.mockRejectedValue(new Error("Reminder failed"));
  const report = vi.spyOn(console, "warn").mockImplementation(() => {});
  await accepted.deleted(saved.id);
  expect(effects.invalidate).toHaveBeenCalledWith([saved.id]);
  expect(effects.removeNotifications).toHaveBeenCalledWith(saved.id);
  expect(report).toHaveBeenCalledWith(
    expect.stringContaining("Forget failed"),
    expect.any(Error),
  );
  expect(report).toHaveBeenCalledWith(
    expect.stringContaining("Reminder failed"),
    expect.any(Error),
  );
});

it("reports non-Error secondary failures without rejecting", async () => {
  expect(
    await acceptedWriteEffect("follow-up failed", () =>
      Promise.reject("rejected"),
    ),
  ).toContain("rejected");
});
