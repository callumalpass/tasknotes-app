import type { JsonObject, MdbaseConnection } from "@mdbase-dev/connect";

import { MdbaseTaskRepository } from "./mdbase-repository";

import type { TaskRepository } from "../application/ports/task-repository";

/** Keep collection topology out of the application UI. */
export function createConnectTaskRepository(
  connect: MdbaseConnection<JsonObject>,
): TaskRepository {
  return new MdbaseTaskRepository(connect);
}
