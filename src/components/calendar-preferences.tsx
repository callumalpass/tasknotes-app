import { appLocale } from "../i18n/app";
import { t } from "@lingui/core/macro";
import { useLingui, Trans } from "@lingui/react/macro";
import { CalendarClock } from "lucide-react";

import {
  orderedWeekdays,
  type CalendarPreferences,
} from "../app/calendar-preferences";
import { TaskNotesSelectField } from "./tasknotes-controls";

export function CalendarPreferencesEditor({
  value,
  onChange,
}: {
  value: CalendarPreferences;
  onChange(value: CalendarPreferences): void;
}) {
  const { t } = useLingui();
  function change(patch: Partial<CalendarPreferences>) {
    onChange({ ...value, ...patch });
  }

  return (
    <div className="calendar-preferences">
      <div className="setting-row">
        <CalendarClock aria-hidden="true" size={20} strokeWidth={1.6} />
        <span>
          <Trans>Calendar display</Trans>
        </span>
        <small>
          <Trans>On this device</Trans>
        </small>
      </div>
      <p className="section-copy">
        <Trans>
          These choices affect calendar layout here without changing the shared
          collection.
        </Trans>
      </p>
      <div className="task-model-settings-grid">
        <TaskNotesSelectField
          label={t({ message: "Week starts" })}
          options={orderedWeekdays(0, appLocale(), "short").map(
            (label, value) => ({
              value: String(value),
              label,
            }),
          )}
          value={String(value.firstDay)}
          onChange={(firstDay) => change({ firstDay: Number(firstDay) })}
        />
        <TaskNotesSelectField
          label={t({ message: "Time format" })}
          options={[
            { value: "locale", label: t({ message: "Device setting" }) },
            { value: "12", label: t({ message: "12 hour" }) },
            { value: "24", label: t({ message: "24 hour" }) },
          ]}
          value={value.hourFormat}
          onChange={(hourFormat) =>
            change({
              hourFormat: hourFormat as CalendarPreferences["hourFormat"],
            })
          }
        />
        <TaskNotesSelectField
          label={t({ message: "Day begins" })}
          options={timeOptions()}
          value={value.slotMinTime}
          onChange={(slotMinTime) => change({ slotMinTime })}
        />
        <TaskNotesSelectField
          label={t({ message: "Day ends" })}
          options={timeOptions(true)}
          value={value.slotMaxTime}
          onChange={(slotMaxTime) => change({ slotMaxTime })}
        />
        <TaskNotesSelectField
          label={t({ message: "Time slot size" })}
          options={[
            { value: "00:15:00", label: t({ message: "15 minutes" }) },
            { value: "00:30:00", label: t({ message: "30 minutes" }) },
            { value: "01:00:00", label: t({ message: "1 hour" }) },
          ]}
          value={value.slotDuration}
          onChange={(slotDuration) => change({ slotDuration })}
        />
      </div>
      <div className="task-model-toggles">
        <Toggle
          checked={value.weekends}
          label={t({ message: "Show weekends" })}
          onChange={(weekends) => change({ weekends })}
        />
        <Toggle
          checked={value.allDaySlot}
          label={t({ message: "Show all-day area" })}
          onChange={(allDaySlot) => change({ allDaySlot })}
        />
        <Toggle
          checked={value.nowIndicator}
          label={t({ message: "Show current time" })}
          onChange={(nowIndicator) => change({ nowIndicator })}
        />
        <Toggle
          checked={value.showTimeEntries}
          label={t({ message: "Show tracked time" })}
          onChange={(showTimeEntries) => change({ showTimeEntries })}
        />
      </div>
    </div>
  );
}

function Toggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange(value: boolean): void;
}) {
  return (
    <label className="task-model-toggle">
      <input
        checked={checked}
        type="checkbox"
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function timeOptions(includeMidnight = false) {
  const result = Array.from({ length: 24 }, (_, hour) => ({
    value: `${String(hour).padStart(2, "0")}:00:00`,
    label: new Intl.DateTimeFormat(appLocale(), { hour: "numeric" }).format(
      new Date(2024, 0, 1, hour),
    ),
  }));
  if (includeMidnight)
    result.push({ value: "24:00:00", label: t({ message: "Midnight" }) });
  return result;
}
