import { useState } from "react";

import {
  basesProperty,
  taskNotesViewSourcePath,
} from "../../domain/default-view-source";
import { readViewDraft, updateViewDocument } from "../../domain/view-document";
import { useRepository } from "../repository-context";

import type { TaskView } from "../../domain/view";

/**
 * Collections created before the starter Today view showed projects keep
 * their saved view untouched. This one-time, dismissible offer adds the
 * project property only when the person chooses it.
 */
export function ProjectPropertyOffer({
  view,
  scope,
  onChanged,
}: {
  view: TaskView;
  scope?: string;
  onChanged(): Promise<unknown>;
}) {
  const { repository, configuration } = useRepository();
  const projects = configuration.fieldMapping.projects;
  const storageKey = `tasknotes:today-projects-offer:${scope ?? ""}:${view.key}`;
  const [dismissed, setDismissed] = useState(() => readDismissed(storageKey));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const offered =
    !dismissed &&
    view.source.writable &&
    view.name === "Today" &&
    view.source.path.toLowerCase() ===
      taskNotesViewSourcePath("Today").toLowerCase() &&
    view.presentation?.type === "tasknotes.task-list" &&
    !view.properties.some((property) =>
      [projects, `note.${projects}`, basesProperty(projects)].includes(
        property.key,
      ),
    );
  if (!offered) return null;

  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(storageKey, "dismissed");
    } catch {
      /* The offer may reappear without persistence. */
    }
  }

  async function accept() {
    setPending(true);
    setError("");
    try {
      const source = await repository.readViewSource(view.source.path);
      const draft = readViewDraft(source, view.id);
      const property =
        draft.dialect === "obsidian-bases" ? basesProperty(projects) : projects;
      await repository.updateViewSource({
        path: source.path,
        ifRevision: source.revision,
        document: updateViewDocument(source, {
          ...draft,
          properties: [...draft.properties, property],
        }),
      });
      dismiss();
      await onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="view-offer" role="status">
      <p>Show each task’s project on Today?</p>
      <div>
        <button
          className="text-action"
          disabled={pending}
          type="button"
          onClick={() => void accept()}
        >
          {pending ? "Adding" : "Show projects"}
        </button>
        <button
          className="text-action quiet"
          disabled={pending}
          type="button"
          onClick={dismiss}
        >
          Not now
        </button>
      </div>
      {error ? (
        <p className="inline-error" role="alert">
          The view could not be updated. {error}
        </p>
      ) : null}
    </div>
  );
}

function readDismissed(key: string): boolean {
  try {
    return localStorage.getItem(key) === "dismissed";
  } catch {
    return false;
  }
}
