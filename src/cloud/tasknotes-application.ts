import {
  MdbaseConnect,
  type MdbaseApplicationDeclaration,
  type MdbaseApplicationEntry,
} from "@mdbase-dev/sdk";
import manifest from "../generated/mdbase-app.json";
import {
  requireTaskNotesAppEnvironment,
  type TaskNotesAppEnvironment,
} from "./app-environment";
import { TASKNOTES_APPLICATION_REGISTRATION } from "./next-application-registration";

/** Declaration data only. The SDK owns registration, assets, Worker and SQL.
 * The generated manifest is not normalized, patched or substituted here. */
export function taskNotesApplicationDeclaration(
  environment: TaskNotesAppEnvironment,
): MdbaseApplicationDeclaration {
  return {
    // The logical, origin-independent identity. mdbase registers each exact
    // manifest under its own UUID; declaring one of those made every changed
    // manifest a "superseded ID". Storage stays pinned, so local data never moves.
    id: manifest.id,
    name: TASKNOTES_APPLICATION_REGISTRATION.appName,
    origin: environment.appOrigin,
    environment: environment.environment,
    manifest,
    storage: {
      applicationNamespace: "tasknotes-web",
      joinDatabaseName: "tasknotes.native-collection-join.v1",
      setupDatabaseName: "tasknotes.native-model-setup.v1",
    },
  };
}

let entry: MdbaseApplicationEntry | null = null;
/** One public owner for this document. A terminal/failed close never creates a
 * replacement client or retries enrollment by constructing another entry. */
export function taskNotesApplicationEntry(): MdbaseApplicationEntry {
  if (entry) return entry;
  const environment = requireTaskNotesAppEnvironment(
    import.meta.env.VITE_TASKNOTES_ENVIRONMENT,
    import.meta.env.VITE_TASKNOTES_LAB_ORIGIN,
    window.location.origin,
  );
  entry = new MdbaseConnect(taskNotesApplicationDeclaration(environment));
  return entry;
}
