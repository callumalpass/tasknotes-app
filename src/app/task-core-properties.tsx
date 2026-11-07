import { useLingui, Trans } from "@lingui/react/macro";
import { useLayoutEffect, useRef, useState } from "react";
import { Circle, Flag } from "lucide-react";
import { ListField } from "./task-editor-layout";
import { TaskNotesSelectField } from "../components/tasknotes-controls";
import { TaskDetailDates } from "../components/task-detail-dates";
import { linkDisplayLabel } from "../domain/completion";
import type {
  FieldCompletion,
  FieldCompletionRequest,
} from "../domain/completion";
import type { TaskCollectionConfiguration } from "../domain/task-configuration";
import type { Draft } from "./task-editor-draft";
import "./task-core-properties.css";

export function TaskCoreProperties({
  draft,
  configuration,
  projectLabels,
  occurrenceNote,
  seriesDates,
  completeField,
  onChange,
}: {
  draft: Draft;
  configuration: TaskCollectionConfiguration;
  projectLabels: ReadonlyMap<string, string>;
  occurrenceNote: boolean;
  seriesDates: boolean;
  completeField(request: FieldCompletionRequest): Promise<FieldCompletion[]>;
  onChange(patch: Partial<Draft>): void;
}) {
  const { t } = useLingui();
  return (
    <section
      className="task-core-properties"
      aria-label={t({ message: "Task properties" })}
    >
      <TaskNotesSelectField
        label={t({ message: "Status" })}
        triggerIcon={<Circle aria-hidden="true" size={14} />}
        disabled={occurrenceNote}
        ariaDescribedBy={occurrenceNote ? "occurrence-status-help" : undefined}
        options={[...configuration.statuses].sort((a, b) => a.order - b.order)}
        value={draft.status}
        onChange={(status) => onChange({ status })}
      />
      {occurrenceNote ? (
        <small id="occurrence-status-help">
          <Trans>Use the occurrence actions above to change this state.</Trans>
        </small>
      ) : null}
      <TaskNotesSelectField
        label={t({ message: "Priority" })}
        triggerIcon={<Flag aria-hidden="true" size={14} />}
        options={configuration.priorities}
        value={draft.priority}
        onChange={(priority) => onChange({ priority })}
      />
      <TaskDetailDates compact draft={draft} onChange={onChange} />
      <InlineList
        compact
        label={t({ message: "Project" })}
        values={draft.projects}
        valueLabels={projectLabels}
        field={configuration.fieldMapping.projects}
        completion={
          configuration.fieldCompletions[
            configuration.fieldMapping.projects
          ] ?? { kind: "records" }
        }
        completeField={completeField}
        onChange={(projects) => onChange({ projects })}
      />
      {seriesDates ? (
        <p className="field-help">
          <Trans>
            These dates edit the repeating task, including future occurrences.
          </Trans>
        </p>
      ) : null}
    </section>
  );
}

export function InlineList({
  compact = false,
  ...props
}: Omit<Parameters<typeof ListField>[0], "placeholder"> & {
  compact?: boolean;
}) {
  const { t } = useLingui();
  const [editing, setEditing] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (editing) root.current?.querySelector("input")?.focus();
  }, [editing]);
  return (
    <div
      className={`task-inline-property${props.values.length ? "" : " is-empty"}`}
      ref={root}
    >
      <span>{props.label}</span>
      {editing ? (
        <div className="task-inline-property-editor">
          <ListField {...props} placeholder={t({ message: "Add" })} />
          <button
            className="text-action"
            type="button"
            onClick={() => {
              setEditing(false);
              requestAnimationFrame(() => trigger.current?.focus());
            }}
          >
            <Trans>Done</Trans>
          </button>
        </div>
      ) : null}
      <button
        ref={trigger}
        className="task-property-value"
        type="button"
        hidden={editing}
        aria-label={t`Edit ${props.label}`}
        aria-expanded={editing}
        onClick={() => setEditing(true)}
      >
        {compact ? <span>{props.label}: </span> : null}
        {props.values.length ? (
          props.values
            .map(
              (value) =>
                props.valueLabels?.get(value) ?? linkDisplayLabel(value),
            )
            .join(", ")
        ) : (
          <span className="task-property-empty">
            <Trans>Add</Trans>
          </span>
        )}
      </button>
    </div>
  );
}
