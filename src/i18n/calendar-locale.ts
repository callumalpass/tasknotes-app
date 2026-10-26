import { t } from "@lingui/core/macro";
import type { CalendarText } from "@tasknotes/calendar";
import { countLabel } from "./default-labels";

/** Calendar copy uses the app catalogue; date formatting uses its Intl locale. */
export function calendarText(): Partial<CalendarText> {
  return {
    today: t`Today`,
    prev: t`Previous period`,
    next: t`Next period`,
    allDay: t`All day`,
    noItems: t`No tasks in this period.`,
    more: (count) => t`+${count} more`,
    itemCount: (count) => countLabel(count, "task"),
    views: {
      month: t`Month`,
      week: t`Week`,
      days: t`3 days`,
      day: t`Day`,
      list: t`Agenda`,
    },
  };
}
