import type { ModelResourcePlan } from "../application/ports/model-setup";

/** Synthetic bounded control-protocol data, never native setup/READ evidence. */
export function resourceSetupPlan(): ModelResourcePlan {
  const hash = "sha256:" + "ab".repeat(32);
  return {
    assessmentDigest: hash,
    provisionDigest: hash,
    packs: [
      { id: "tasknotes.task", version: "0.3.0-rc.18", digest: hash },
      { id: "obsidian.base", version: "1.0.0", digest: hash },
    ],
    resourceOps: [
      {
        kind: "resource_put",
        path: "_types/task.md",
        doc: "Synthetic resource fixture",
        mustNotExist: true,
      },
    ],
    resourceReadback: [
      { path: "_types/task.md", doc: "Synthetic resource fixture" },
    ],
    sources: [
      {
        id: "44444444-4444-4444-8444-444444444444",
        path: "TaskNotes/Views/today.base",
        document: "views: [{type: tasknotesTaskList}]\n",
      },
    ],
  };
}
