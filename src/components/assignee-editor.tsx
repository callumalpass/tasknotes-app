import { useState } from "react";
import { usePeople } from "../app/use-people";

export function AssigneeEditor({
  values,
  onChange,
}: {
  values: string[];
  onChange(values: string[]): void;
}) {
  const [editing, setEditing] = useState(false);
  const { directory, error, retry, supported } = usePeople(
    editing || values.length > 0,
  );
  if (!supported && values.length === 0) return null;
  const label = (id: string) => {
    const matches =
      directory?.people.filter((person) => person.id === id) ?? [];
    if (matches.length > 1) return `Ambiguous person · ${id}`;
    if (matches.length === 0)
      return `${directory ? "Unresolved person" : "Person"} · ${id}`;
    if (matches[0].ambiguousIdentity)
      return `${matches[0].name} (ambiguous account link)`;
    return `${matches[0].name}${matches[0].activeMember ? "" : " (not linked to an active member)"}`;
  };
  const choices =
    directory?.people.filter(
      (person) =>
        person.activeMember &&
        !person.ambiguousId &&
        !person.ambiguousIdentity &&
        !values.includes(person.id),
    ) ?? [];
  return (
    <fieldset className="assignee-editor">
      <legend>Assigned to</legend>
      {values.length ? (
        <ul>
          {values.map((id) => (
            <li key={id}>
              <span>{label(id)}</span>
              <button
                type="button"
                aria-label={`Remove assignment to ${label(id)}`}
                onClick={() => onChange(values.filter((value) => value !== id))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p>Unassigned</p>
      )}
      {supported && !editing && (
        <button type="button" onClick={() => setEditing(true)}>
          Choose assignees
        </button>
      )}
      {editing && supported && !directory && !error && (
        <p role="status">Loading people…</p>
      )}
      {editing && error && (
        <div role="alert">
          <p>
            People could not be loaded. Existing assignments are unchanged.{" "}
            {error.message}
          </p>
          <button type="button" onClick={retry}>
            Retry people
          </button>
        </div>
      )}
      {editing && directory && (
        <>
          <label>
            Add an assignee
            <select
              aria-label="Add an assignee"
              value=""
              disabled={!choices.length}
              onChange={(event) => {
                if (event.target.value)
                  onChange([...values, event.target.value]);
              }}
            >
              <option value="">Choose a collection member…</option>
              {choices.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name} · {person.path}
                </option>
              ))}
            </select>
          </label>
          {!choices.length && (
            <p>No additional members have a unique linked person record.</p>
          )}
          <a
            href={directory.profileUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Choose or create your person record in Connect
          </a>
        </>
      )}
      {editing && (
        <button type="button" onClick={() => setEditing(false)}>
          Done choosing assignees
        </button>
      )}
      <p>
        Assignments reference person notes. They do not grant collection access.
      </p>
    </fieldset>
  );
}
