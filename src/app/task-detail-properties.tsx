import { Trans } from "@lingui/react/macro";
import { TaskCoreProperties } from "./task-core-properties";
import { CustomField } from "./task-custom-field";
import {
  isEmptyFieldValue,
  scheduleSummary,
  type Draft,
} from "./task-editor-draft";
import type { Task } from "../domain/task";

export function TaskDetailProperties({
  task,
  occurrenceDate,
  ...props
}: Parameters<typeof TaskCoreProperties>[0] & {
  task: Task;
  occurrenceDate?: string;
}) {
  const { draft, configuration, completeField, onChange } = props;
  return (
    <details className="task-properties-disclosure">
      <summary>
        <span>
          <strong>
            <Trans>Task properties</Trans>
          </strong>
          <small>
            {scheduleSummary(task, draft, configuration, occurrenceDate)}
          </small>
        </span>
      </summary>
      <TaskCoreProperties {...props} />
      {configuration.userFields.length ? (
        <div className="field-grid metadata-fields">
          {configuration.userFields.map((field) => (
            <CustomField
              completion={configuration.fieldCompletions[field.key]}
              completeField={completeField}
              field={field}
              key={field.key}
              value={draft.customProperties[field.key]}
              onChange={(value) => {
                const customProperties: Draft["customProperties"] = {
                  ...draft.customProperties,
                };
                if (isEmptyFieldValue(value))
                  delete customProperties[field.key];
                else customProperties[field.key] = value;
                onChange({ customProperties });
              }}
            />
          ))}
        </div>
      ) : null}
    </details>
  );
}
