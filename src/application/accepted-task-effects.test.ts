import { expect, it, vi } from "vitest";
import type { Task } from "../domain/task";
import { AcceptedTaskEffects } from "./accepted-task-effects";

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
