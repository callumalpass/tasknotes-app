import { plural, t } from "@lingui/core/macro";
import { countLabel } from "../i18n/default-labels";
import { formatTaskDate } from "../i18n/presentation";
import type { BulkTaskChange } from "../application/bulk-task-edit";

export function bulkTaskFeedback(
  change: BulkTaskChange,
  count: number,
  value: string,
  movedDueDates = 0,
) {
  const tasks = countLabel(count, "task");
  switch (change.kind) {
    case "complete":
      return {
        message: t`Completed ${tasks}`,
        undoNotice: t`Restored completion states for ${tasks}`,
      };
    case "schedule": {
      const date = change.date ? formatTaskDate(change.date) : "";
      return {
        message: !change.date
          ? t`Removed scheduled dates from ${tasks}`
          : movedDueDates
            ? plural(movedDueDates, {
                one: `Scheduled ${tasks} for ${date} and moved # missed due date`,
                other: `Scheduled ${tasks} for ${date} and moved # missed due dates`,
              })
            : t`Scheduled ${tasks} for ${formatTaskDate(change.date)}`,
        undoNotice: t`Restored dates for ${tasks}`,
      };
    }
    case "status":
      return {
        message: t`Set status to ${value} for ${tasks}`,
        undoNotice: t`Restored statuses for ${tasks}`,
      };
    case "tag":
      return {
        message: change.remove
          ? t`Removed tag ${value} from ${tasks}`
          : t`Added tag ${value} to ${tasks}`,
        undoNotice: t`Restored tags for ${tasks}`,
      };
    case "priority":
      return {
        message: t`Set priority to ${value} for ${tasks}`,
        undoNotice: t`Restored priorities for ${tasks}`,
      };
    case "project":
      return {
        message: value
          ? t`Moved ${tasks} to ${value}`
          : t`Removed projects from ${tasks}`,
        undoNotice: t`Restored projects for ${tasks}`,
      };
    case "archive":
      return {
        message: t`Archived ${tasks}`,
        undoNotice: t`Restored ${tasks} from archive`,
      };
  }
}
