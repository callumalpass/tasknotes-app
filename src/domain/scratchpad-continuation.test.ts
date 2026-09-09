import { expect, it } from "vitest";
import { createScratchNode } from "./scratchpad";
import { ensureScratchContinuation } from "./scratchpad-continuation";

it("adds a focused continuation candidate after the final task", () => {
  const task = {
    ...createScratchNode("draft", 0, "Task"),
    kind: "task" as const,
  };
  const result = ensureScratchContinuation([task], task.id);
  expect(result.nodes).toHaveLength(2);
  expect(result.nodes[1]).toMatchObject({
    id: result.continuationId,
    kind: "draft",
    text: "",
    depth: 0,
  });
});
it("keeps descendants attached and does not duplicate an existing blank sibling", () => {
  const task = {
    ...createScratchNode("draft", 0, "Task"),
    kind: "task" as const,
  };
  const child = createScratchNode("draft", 1, "Child");
  const blank = createScratchNode("draft", 0);
  const nodes = [task, child, blank];
  expect(ensureScratchContinuation(nodes, task.id)).toEqual({
    nodes,
    continuationId: blank.id,
  });
  const added = ensureScratchContinuation([task, child], task.id);
  expect(added.nodes.slice(0, 2)).toEqual([task, child]);
  expect(added.nodes[2]?.depth).toBe(0);
});
