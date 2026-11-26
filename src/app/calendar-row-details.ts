import { t } from "@lingui/core/macro";
import { linkDisplayLabel } from "../domain/completion";
import { taskDatePart } from "../domain/task";
import { occurrenceTask } from "../domain/task-occurrence";
import type { CalendarEntry } from "../domain/calendar-events";
import type { TaskCollectionConfiguration } from "../domain/task-configuration";
import type { TaskViewExecution } from "../domain/view";
import {
  formatPropertyValue,
  viewPropertyDetails,
} from "../i18n/view-presentation";
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
  const markerTag =
    configuration.taskIdentification?.method === "property"
      ? null
      : (
          configuration.taskIdentification?.tag?.trim() ||
          configuration.defaults?.taskTag?.trim() ||
          "task"
        )
          .replace(/^#+/, "")
          .toLocaleLowerCase();
  const shown = details.flatMap((detail) => {
    const key = fieldKey(detail.key);
    const date = ["scheduled", configuration.fieldMapping.scheduled].includes(
      key,
    );
    if (
      day &&
      date &&
      typeof detail.rawValue === "string" &&
      taskDatePart(detail.rawValue) === day
    )
      return [];
    if (markerTag && (key === "tags" || key === "file.tags")) {
      const isMarker = (entry: unknown) =>
        typeof entry === "string" &&
        entry.trim().replace(/^#+/, "").toLocaleLowerCase() === markerTag;
      if (Array.isArray(detail.rawValue)) {
        const visible = detail.rawValue.filter((entry) => !isMarker(entry));
        const value = formatPropertyValue(visible);
        return value === null ? [] : [{ ...detail, rawValue: visible, value }];
      }
      if (isMarker(detail.rawValue)) return [];
    }
    return [detail];
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
