import { afterEach, expect, it, vi } from "vitest";
import type { Task } from "../domain/task";
import { rememberTaskEdit } from "./task-edit-undo";
import { clearUndoHistory, onUndoNotice, takeUndo } from "./undo-history";

afterEach(clearUndoHistory);

it("acknowledges an edit and restores only its changed fields through Undo", async () => {
  const before = {
    id: "one",
    title: "Custom task",
    priority: "low",
    revision: 1,
  } as Task;
  const saved = { ...before, priority: "Custom priority", revision: 2 };
  const updateTask = vi.fn(async () => before);
  const notice = vi.fn();
  const unsubscribe = onUndoNotice(notice);
  rememberTaskEdit({
    before,
    saved,
    input: { priority: saved.priority },
    notice: "Updated",
    getSummary: async () => saved,
    updateTask,
  });
  expect(notice).toHaveBeenCalledOnce();
  await takeUndo()!.run();
  expect(updateTask).toHaveBeenCalledWith("one", { priority: "low" });
  unsubscribe();
});

it("refuses to overwrite a later edit when Undo is invoked", async () => {
  const before = {
    id: "one",
    title: "Custom task",
    priority: "low",
    revision: 1,
  } as Task;
  const saved = { ...before, priority: "Custom priority", revision: 2 };
  const updateTask = vi.fn();
  rememberTaskEdit({
    before,
    saved,
    input: { priority: saved.priority },
    notice: "Updated",
    getSummary: async () => ({ ...saved, revision: 3 }),
    updateTask,
  });
  await expect(takeUndo()!.run()).rejects.toThrow("This task changed");
  expect(updateTask).not.toHaveBeenCalled();
});
