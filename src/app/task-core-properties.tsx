import { useLingui, Trans } from "@lingui/react/macro";
import { useLayoutEffect, useRef, useState } from "react";
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
      <div className="task-core-dates">
        <TaskDetailDates draft={draft} onChange={onChange} />
      </div>
      {seriesDates ? (
        <p className="field-help">
          <Trans>
            These dates edit the repeating task, including future occurrences.
          </Trans>
        </p>
      ) : null}
      <TaskNotesSelectField
        label={t({ message: "Priority" })}
        options={configuration.priorities}
        value={draft.priority}
        onChange={(priority) => onChange({ priority })}
      />
      <InlineList
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
      <InlineList
        label={t({ message: "Tags" })}
        values={draft.tags.filter((tag) => tag !== "task")}
        field="tags"
        completion={configuration.fieldCompletions.tags ?? { kind: "values" }}
        completeField={completeField}
        onChange={(tags) => onChange({ tags: ["task", ...tags] })}
      />
    </section>
  );
}

function InlineList(
  props: Omit<Parameters<typeof ListField>[0], "placeholder">,
) {
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
