import { createScratchNode, scratchSubtreeEnd } from "./scratchpad";
import type { ScratchNode } from "./scratchpad";

/** Insert a sibling after the whole branch, never between a parent and its children. */
export function ensureScratchContinuation(nodes: ScratchNode[], id: string) {
  const index = nodes.findIndex((node) => node.id === id);
  if (index < 0)
    throw new Error("The converted line is no longer in the scratchpad.");
  const depth = nodes[index]!.depth;
  const end = scratchSubtreeEnd(nodes, index);
  const next = nodes[end];
  if (next && next.kind !== "task" && !next.text.trim() && next.depth === depth)
    return { nodes, continuationId: next.id };
  const created = createScratchNode("draft", depth);
  return {
    nodes: [...nodes.slice(0, end), created, ...nodes.slice(end)],
    continuationId: created.id,
  };
}
