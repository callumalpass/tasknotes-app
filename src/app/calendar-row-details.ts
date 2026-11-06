import { t } from "@lingui/core/macro";
import { linkDisplayLabel } from "../domain/completion";
import { taskDatePart } from "../domain/task";
import { occurrenceTask } from "../domain/task-occurrence";
import type { CalendarEntry } from "../domain/calendar-events";
import type { TaskCollectionConfiguration } from "../domain/task-configuration";
import type { TaskViewExecution } from "../domain/view";
import { viewPropertyDetails } from "../i18n/view-presentation";
import {
  calendarPriorityMarker,
  withPriorityDetail,
} from "./calendar-event-presentation";

export function calendarRowDetails(
  entry: CalendarEntry,
  execution: TaskViewExecution,
  titleProperty: string,
  configuration: TaskCollectionConfiguration,
  day?: string,
) {
  const displayed = entry.occurrence
    ? occurrenceTask(entry.occurrence)
    : entry.task;
  const details =
    viewPropertyDetails(entry.row, execution.view.properties, {
      identityProperty: titleProperty,
      occurrence: entry.occurrence,
    }) ??
    (["scheduled", "due"] as const).flatMap((field) =>
      displayed[field]
        ? [
            {
              key: field,
              label: field === "scheduled" ? t`Scheduled` : t`Due`,
              value: displayed[field],
              rawValue: displayed[field],
            },
          ]
        : [],
    );
  const fieldKey = (key: string) =>
    /^note\[(["'])(.+)\1\]$/.exec(key)?.[2] ?? key.replace(/^note\./, "");
  const shown = details.filter((detail) => {
    const key = fieldKey(detail.key);
    const date = ["scheduled", configuration.fieldMapping.scheduled].includes(
      key,
    );
    return (
      !day ||
      !date ||
      typeof detail.rawValue !== "string" ||
      taskDatePart(detail.rawValue) !== day
    );
  });
  if (
    displayed.projects.length &&
    !shown.some((detail) =>
      ["projects", configuration.fieldMapping.projects].includes(
        fieldKey(detail.key),
      ),
    )
  )
    shown.push({
      key: configuration.fieldMapping.projects,
      label: t`Project`,
      value: displayed.projects.map(linkDisplayLabel).join(", "),
      rawValue: displayed.projects,
    });
  return withPriorityDetail(
    shown,
    calendarPriorityMarker(displayed, configuration),
    configuration,
  );
}
