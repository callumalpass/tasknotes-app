import { useLingui } from "@lingui/react/macro";
import { ArrowDown, ArrowUp, Check } from "lucide-react";
import type { TaskCollectionConfiguration } from "../domain/task-configuration";
import type { TaskViewSort } from "../domain/view";

/** The everyday sorts, one click away from the full view editor. */
export function ViewSortChoices({
  configuration,
  disabled,
  sort,
  onChoose,
}: {
  configuration: TaskCollectionConfiguration;
  disabled: boolean;
  sort: readonly TaskViewSort[] | undefined;
  onChoose(field: string): void;
}) {
  const { t } = useLingui();
  const { due, priority, scheduled, title } = configuration.fieldMapping;
  const lead = sort?.[0];
  const leadField = lead?.property.replace(/^note\./, "");
  const choices = [
    { field: priority, label: t`Priority` },
    { field: due, label: t`Due date` },
    { field: scheduled, label: t`Scheduled date` },
    { field: title, label: t`Title` },
  ];
  return (
    <>
      {choices.map(({ field, label }) => {
        const active = leadField === field;
        const Direction = lead?.direction === "desc" ? ArrowDown : ArrowUp;
        return (
          <button
            aria-pressed={active}
            disabled={disabled}
            key={field}
            type="button"
            onClick={() => onChoose(field)}
          >
            {active ? (
              <Check aria-hidden="true" size={18} />
            ) : (
              <span aria-hidden="true" className="layout-option-space" />
            )}
            {label}
            {active ? (
              <Direction
                aria-hidden="true"
                className="view-sort-direction"
                size={14}
              />
            ) : null}
          </button>
        );
      })}
    </>
  );
}
