import { describe, expect, it } from "vitest";
import { taskPathCandidates } from "./task-path-policy";

describe("TaskNotes filename candidates", () => {
  it("keeps the requested name first, then the existing Markdown suffix convention", () => {
    const paths = taskPathCandidates("tasks/20261006.md");
    expect(paths.next().value).toBe("tasks/20261006.md");
    expect(paths.next().value).toBe("tasks/20261006-2.md");
    expect(paths.next().value).toBe("tasks/20261006-3.md");
  });
  it("preserves the existing finite allocation bound", () => {
    const paths = [...taskPathCandidates("tasks/note")];
    expect(paths).toHaveLength(9999);
    expect(paths.at(-1)).toBe("tasks/note-9999");
  });
});
