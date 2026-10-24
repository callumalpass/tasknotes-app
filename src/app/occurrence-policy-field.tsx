import { useLingui, Trans } from "@lingui/react/macro";
import type { Task } from "../domain/task";
import type { Draft } from "./task-editor-draft";
import {
  TaskNotesSelect,
  TaskNotesSelectField,
} from "../components/tasknotes-controls";

export function OccurrencePolicyField({
  materialization,
  nextTrigger,
  template,
  pastHorizon,
  futureHorizon,
  onChange,
}: {
  materialization: "manual" | "on_completion" | "rolling";
  nextTrigger: "completion" | "completion_or_skip";
  template?: string;
  pastHorizon?: string;
  futureHorizon?: string;
  onChange(value: Partial<Draft>): void;
}) {
  const { t } = useLingui();
  return (
    <section className="repeat-fields occurrence-policy">
      <div className="repeat-heading">
        <div>
          <span className="field-label">
            <Trans>Occurrence notes</Trans>
          </span>
          <p>
            <Trans>Keep individual Markdown notes for recurring dates.</Trans>
          </p>
        </div>
        <TaskNotesSelect
          ariaLabel={t({ message: "Occurrence note policy" })}
          options={[
            { value: "manual", label: t({ message: "When I choose" }) },
            {
              value: "on_completion",
              label: t({ message: "Create the next after completion" }),
            },
            {
              value: "rolling",
              label: t({ message: "Keep a rolling window" }),
            },
          ]}
          value={materialization}
          onChange={(value) =>
            onChange({
              occurrenceMaterialization:
                value as Task["occurrenceMaterialization"],
            })
          }
        />
      </div>
      {materialization === "on_completion" ? (
        <TaskNotesSelectField
          label={t({ message: "Advance after" })}
          options={[
            { value: "completion", label: t({ message: "Completion" }) },
            {
              value: "completion_or_skip",
              label: t({ message: "Completion or skip" }),
            },
          ]}
          value={nextTrigger}
          onChange={(value) =>
            onChange({
              occurrenceNextTrigger: value as Task["occurrenceNextTrigger"],
            })
          }
        />
      ) : null}
      {materialization === "rolling" ? (
        <div className="field-grid metadata-fields">
          <label className="form-field">
            <span>
              <Trans>Past horizon</Trans>
            </span>
            <input
              placeholder={t({ message: "P0D" })}
              value={pastHorizon ?? ""}
              onChange={(event) =>
                onChange({ occurrencePastHorizon: event.target.value })
              }
            />
          </label>
          <label className="form-field">
            <span>
              <Trans>Future horizon</Trans>
            </span>
            <input
              placeholder={t({ message: "P14D" })}
              value={futureHorizon ?? ""}
              onChange={(event) =>
                onChange({ occurrenceFutureHorizon: event.target.value })
              }
            />
          </label>
        </div>
      ) : null}
      <label className="form-field">
        <span>
          <Trans>Occurrence template</Trans>
        </span>
        <input
          placeholder={t({ message: "Templates/Occurrence.md" })}
          value={template ?? ""}
          onChange={(event) =>
            onChange({ occurrenceTemplate: event.target.value })
          }
        />
      </label>
    </section>
  );
}
