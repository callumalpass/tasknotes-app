import type { JsonObject, MdbaseConnection } from "@mdbase-dev/connect";

import { CloudTaskRepository } from "./cloud-repository";
import { RelayTaskRepository } from "./relay-repository";

import type { TaskRepository } from "./repository";

/** Keep collection topology out of the application UI. */
export function createConnectTaskRepository(
  connect: MdbaseConnection<JsonObject>,
): TaskRepository {
  return connect.sync()
    ? new CloudTaskRepository(connect)
    : new RelayTaskRepository(connect);
}
