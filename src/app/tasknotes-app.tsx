import { NextCollectionGate } from "./next-collection-gate";

/** Every production route uses the original synced collection gate. */
export function TaskNotesApp() {
  return <NextCollectionGate />;
}
