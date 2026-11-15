import type { SourceData } from "tasknotes-import/todoist";

type SourceReturn = { source: SourceData } | { error: unknown };
let returned: Promise<SourceReturn> | undefined;

export function captureTodoistReturn(url: URL): void {
  const base = import.meta.env.BASE_URL;
  if (url.pathname !== `${base}import/todoist/callback`) return;
  history.replaceState(null, "", `${base}import`);
  returned = import("./todoist-authorization")
    .then((authorization) => authorization.loadTodoistReturn(url))
    .then(
      (source) => ({ source }),
      (error: unknown) => ({ error }),
    );
}

export function todoistReturn(): Promise<SourceReturn | undefined> {
  return returned ?? Promise.resolve(undefined);
}

export function clearTodoistReturn(): void {
  returned = undefined;
}
