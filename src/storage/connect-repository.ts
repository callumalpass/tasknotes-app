import type { JsonObject, MdbaseConnect } from "@mdbase/connect";

import { CloudTaskRepository } from "./cloud-repository";
import { RelayTaskRepository } from "./relay-repository";

import type { TaskRepository } from "./repository";

/** Keep collection topology out of the application UI. */
export function createConnectTaskRepository(
  connect: MdbaseConnect<JsonObject>,
): TaskRepository {
  return connect.hostedSync()
    ? new CloudTaskRepository(connect)
    : new RelayTaskRepository(connect);
}
