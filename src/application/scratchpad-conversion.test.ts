import { describe, expect, it, vi } from "vitest";
import {
  TaskRevisionChangedError,
  type TaskRepository,
} from "./ports/task-repository";
import {
  undoScratchpadConversion,
  type ScratchpadConversion,
} from "./scratchpad-conversion";
import type { TaskSummary } from "../domain/task";

function setup() {
  const task = { id: "created", revision: 1 } as TaskSummary;
  const conversion: ScratchpadConversion = {
    draft: {
      id: "draft",
      kind: "draft",
      depth: 0,
      text: "Original !high",
      completed: true,
    },
    linked: {
      id: "draft",
      kind: "task",
      depth: 0,
      text: "Original",
      link: "[[tasks/created]]",
      taskId: task.id,
    },
    task,
    children: [],
  };
  const repository = {
    get: vi.fn().mockResolvedValue(task),
    delete: vi.fn().mockResolvedValue(undefined),
    update: vi.fn(),
  };
  return {
    conversion,
    repository,
    repo: repository as unknown as TaskRepository,
  };
}

describe("Scratchpad conversion Undo", () => {
  it("deletes only the unchanged creation revision so the original draft can be restored", async () => {
    const { conversion, repository, repo } = setup();
    expect(
      await undoScratchpadConversion(repo, conversion, () => [
        conversion.linked,
      ]),
    ).toBe("restored");
    expect(repository.delete).toHaveBeenCalledWith("created", {
      expectedRevision: 1,
    });
    expect(conversion.draft.text).toBe("Original !high");
    expect(conversion.draft.completed).toBe(true);
  });

  it("keeps a task edited after creation and restores nothing", async () => {
    const { conversion, repository, repo } = setup();
    repository.get.mockResolvedValue({ ...conversion.task, revision: 2 });
    expect(
      await undoScratchpadConversion(repo, conversion, () => [
        conversion.linked,
      ]),
    ).toBe("changed");
    expect(repository.delete).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
  });

  it("refuses deletion when the task changes between checking and submission", async () => {
    const { conversion, repository, repo } = setup();
    repository.delete.mockRejectedValue(new TaskRevisionChangedError());
    expect(
      await undoScratchpadConversion(repo, conversion, () => [
        conversion.linked,
      ]),
    ).toBe("changed");
  });

  it("keeps later edits to the linked note and checks again after asynchronous reads", async () => {
    const { conversion, repository, repo } = setup();
    const nodes = vi
      .fn()
      .mockReturnValueOnce([conversion.linked])
      .mockReturnValue([{ ...conversion.linked, text: "Later note edit" }]);
    expect(await undoScratchpadConversion(repo, conversion, nodes)).toBe(
      "changed",
    );
    expect(repository.delete).not.toHaveBeenCalled();
  });

  it("restores an unchanged existing child's original project relationship", async () => {
    const { conversion, repository, repo } = setup();
    const before = {
      id: "child",
      revision: 1,
      projects: ["Existing project"],
    } as TaskSummary;
    const after = {
      ...before,
      revision: 2,
      projects: [...before.projects, conversion.linked.link!],
    };
    conversion.children = [{ before, after }];
    repository.get.mockImplementation(async (id: string) =>
      id === "child" ? after : conversion.task,
    );
    expect(
      await undoScratchpadConversion(repo, conversion, () => [
        conversion.linked,
      ]),
    ).toBe("restored");
    expect(repository.update).toHaveBeenCalledWith(
      "child",
      { projects: before.projects },
      { expectedRevision: 2 },
    );
  });
});
