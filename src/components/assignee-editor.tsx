import { useLingui, Trans } from "@lingui/react/macro";
import { Check, RefreshCw, UsersRound, X } from "lucide-react";
import { useState } from "react";
import { PersonSetupLink } from "./person-setup-link";
import { useAssigneeTargets, usePeople } from "../app/use-people";
import { linkDisplayLabel, recordCompletion } from "../domain/completion";

/** Assignees are links to person records; mdbase resolves them. */
export function AssigneeEditor({
  taskId,
  values,
  linkWriteFormat,
  onChange,
}: {
  taskId: string;
  values: string[];
  linkWriteFormat: "wikilink" | "markdown";
  onChange(values: string[]): void;
}) {
  const { t } = useLingui();
  const [editing, setEditing] = useState(false);
  // Links chosen in this session point at a known record before they are saved.
  const [chosen, setChosen] = useState(() => new Map<string, string>());
  const active = editing || values.length > 0;
  const { directory, error, retry, openedSettings, supported } =
    usePeople(active);
  const saved = useAssigneeTargets(taskId, active && supported);
  if (!supported && values.length === 0) return null;
  const target = (value: string) => chosen.get(value) ?? saved?.get(value);
  const label = (value: string) => {
    const name = linkDisplayLabel(value);
    const path = target(value);
    if (path === null) return t`${name} (no matching person record)`;
    if (path === undefined || !directory) return name;
    const person = directory.people.find(
      (candidate) => candidate.path === path,
    );
    if (!person) return t`${name} (not a person record)`;
    if (person.ambiguousIdentity)
      return t`${person.name} (ambiguous account link)`;
    return `${person.name}${person.activeMember === false ? t({ message: " (not linked to an active member)" }) : ""}`;
  };
  const assignedPaths = new Set(values.map(target));
  const choices =
    directory?.people.filter(
      (person) =>
        // Unknown membership (directory not shared) does not hide anyone.
        person.activeMember !== false &&
        !person.ambiguousIdentity &&
        !assignedPaths.has(person.path),
    ) ?? [];
  const choose = (path: string) => {
    const person = directory?.people.find(
      (candidate) => candidate.path === path,
    );
    if (!person) return;
    const link = recordCompletion(
      { path: person.path, label: person.name, frontmatter: {}, types: [] },
      linkWriteFormat,
    ).value;
    setChosen((current) => new Map(current).set(link, person.path));
    onChange([...values, link]);
  };
  return (
    <fieldset className="assignee-editor">
      <legend>
        <Trans>Assigned to</Trans>
      </legend>
      {values.length ? (
        <ul>
          {values.map((value) => (
            <li key={value}>
              <span>{label(value)}</span>
              <button
                type="button"
                className="people-action people-action--quiet"
                aria-label={t`Remove assignment to ${label(value)}`}
                onClick={() =>
                  onChange(values.filter((candidate) => candidate !== value))
                }
              >
                <X size={16} aria-hidden="true" />
                <Trans>Remove</Trans>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p>
          <Trans>Unassigned</Trans>
        </p>
      )}
      {supported && !editing && (
        <button
          className="people-action"
          type="button"
          onClick={() => setEditing(true)}
        >
          <UsersRound size={18} aria-hidden="true" />
          <Trans>Choose assignees</Trans>
        </button>
      )}
      {editing && supported && !directory && !error && (
        <p role="status">
          <Trans>Loading people…</Trans>
        </p>
      )}
      {editing && error && (
        <div role="alert">
          <p>
            <Trans>
              People could not be loaded. Existing assignments are unchanged.{" "}
              {error.message}
            </Trans>
          </p>
          <button className="people-action" type="button" onClick={retry}>
            <RefreshCw size={18} aria-hidden="true" />
            <Trans>Retry people</Trans>
          </button>
        </div>
      )}
      {editing && directory && (
        <>
          <label>
            <Trans>Add an assignee</Trans>
            <select
              aria-label={t({ message: "Add an assignee" })}
              value=""
              disabled={!choices.length}
              onChange={(event) => {
                if (event.target.value) choose(event.target.value);
              }}
            >
              <option value="">
                <Trans>Choose a person…</Trans>
              </option>
              {choices.map((person) => (
                <option key={person.path} value={person.path}>
                  {person.name} · {person.path}
                </option>
              ))}
            </select>
          </label>
          {!choices.length && (
            <p>
              <Trans>No other people are available to assign.</Trans>
            </p>
          )}
          {directory.settingsUrl && (
            <div className="people-actions">
              <PersonSetupLink
                href={directory.settingsUrl}
                onOpen={openedSettings}
              />
            </div>
          )}
        </>
      )}
      {editing && (
        <button
          className="people-action"
          type="button"
          onClick={() => setEditing(false)}
        >
          <Check size={18} aria-hidden="true" />
          <Trans>Done choosing assignees</Trans>
        </button>
      )}
      <p className="assignee-help">
        <Trans>
          Assignments link to person notes, which list them as backlinks. They
          do not grant collection access.
        </Trans>
      </p>
    </fieldset>
  );
}
