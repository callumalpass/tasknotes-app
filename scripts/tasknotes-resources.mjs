import { buildTaskNotesStarterResources } from "@tasknotes/model/starter";

// The published TaskNotes starter (the tasknotes.task pack's seed type). It is
// defined, and pinned to the published pack, in @tasknotes/model.
export function buildAppTaskNotesResources() {
  return buildTaskNotesStarterResources();
}
