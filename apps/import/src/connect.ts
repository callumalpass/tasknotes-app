import {
  createMdbase,
  type MdbaseApplicationConnection,
} from "@mdbase-dev/sdk";
import { MdbaseTaskRepository } from "./storage/task-repository";
import type { TaskRepository } from "./task-repository";
import manifest from "./generated/mdbase-app.json";
import site from "./generated/site.json";

export const session = createMdbase({
  id: manifest.id,
  name: manifest.name,
  origin: site.origin,
  environment: "production",
  manifest,
});

export function taskRepository(
  connection: MdbaseApplicationConnection,
): TaskRepository {
  return new MdbaseTaskRepository(connection);
}
