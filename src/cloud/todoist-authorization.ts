import {
  authorizeTodoist,
  completeTodoist,
} from "tasknotes-import/authorization";
import { TodoistApi } from "tasknotes-import/todoist";
import manifest from "../generated/mdbase-app.json";

const origin = new URL(manifest.homepage).origin;
const base = import.meta.env.BASE_URL;

export function connectTodoist(): Promise<void> {
  return authorizeTodoist({
    origin,
    callbackPath: `${base}import/todoist/callback`,
    metadataPath: `${base}oauth/todoist-client.json`,
  });
}

export async function loadTodoistReturn(url: URL) {
  if (url.origin !== origin)
    throw new Error("Unexpected Todoist callback origin.");
  return new TodoistApi(await completeTodoist(url)).load();
}
