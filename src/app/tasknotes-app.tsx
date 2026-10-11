import { ApplicationCollectionGate } from "./application-collection-gate";
import { CollectionPicker } from "./collection-picker";

/** All routes share one SDK-owned application and its original scoped client. */
export function TaskNotesApp() {
  return <ApplicationCollectionGate Picker={CollectionPicker} />;
}
