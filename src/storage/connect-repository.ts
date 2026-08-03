import type {
  JsonObject,
  MdbaseConnection,
  MdbaseEffectiveCapabilities,
} from "@mdbase-dev/connect";

import { CloudTaskRepository } from "./cloud-repository";
import { RelayTaskRepository } from "./relay-repository";

import type { TaskRepository } from "../application/ports/task-repository";

/** Keep collection topology out of the application UI. */
export function createConnectTaskRepository(
  connect: MdbaseConnection<JsonObject>,
  capabilities: MdbaseEffectiveCapabilities,
): TaskRepository {
  return capabilities.values["sync.offline-replica"]?.state === "available"
    ? new CloudTaskRepository(connect)
    : new RelayTaskRepository(connect);
}
