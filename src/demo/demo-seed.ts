import type { Task } from "../domain/task";
import type { TaskNotesTaskModel } from "../domain/tasknotes-model";
import type { ScratchpadDocument } from "../domain/scratchpad";

/** A curated demo collection, used in place of the generated demo tasks. */
export interface DemoSeed {
  tasks(model: TaskNotesTaskModel): Task[];
  /** Exactly one note is active; the others are Scratchpad history. */
  scratchpads(now: Date): ScratchpadDocument[];
}
