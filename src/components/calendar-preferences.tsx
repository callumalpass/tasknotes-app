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
  function change(patch: Partial<CalendarPreferences>) {
    onChange({ ...value, ...patch });
  }

  return (
    <div className="calendar-preferences">
      <div className="setting-row task-model-setting-row">
        <CalendarClock aria-hidden="true" size={20} strokeWidth={1.6} />
        <span>Calendar display</span>
        <small>On this device</small>
      </div>
      <p className="section-copy">
        These choices affect calendar layout here without changing the shared
        collection.
      </p>
      <div className="task-model-settings-grid">
        <TaskNotesSelectField
          label="Week starts"
          options={orderedWeekdays(0, undefined, "short").map(
            (label, value) => ({
              value: String(value),
              label,
            }),
          )}
          value={String(value.firstDay)}
          onChange={(firstDay) => change({ firstDay: Number(firstDay) })}
        />
        <TaskNotesSelectField
          label="Time format"
          options={[
            { value: "locale", label: "Device setting" },
            { value: "12", label: "12 hour" },
            { value: "24", label: "24 hour" },
          ]}
          value={value.hourFormat}
          onChange={(hourFormat) =>
            change({
              hourFormat: hourFormat as CalendarPreferences["hourFormat"],
            })
          }
        />
        <TaskNotesSelectField
          label="Day begins"
          options={timeOptions()}
          value={value.slotMinTime}
          onChange={(slotMinTime) => change({ slotMinTime })}
        />
        <TaskNotesSelectField
          label="Day ends"
          options={timeOptions(true)}
          value={value.slotMaxTime}
          onChange={(slotMaxTime) => change({ slotMaxTime })}
        />
        <TaskNotesSelectField
          label="Time slot size"
          options={[
            { value: "00:15:00", label: "15 minutes" },
            { value: "00:30:00", label: "30 minutes" },
            { value: "01:00:00", label: "1 hour" },
          ]}
          value={value.slotDuration}
          onChange={(slotDuration) => change({ slotDuration })}
        />
      </div>
      <div className="task-model-toggles">
        <Toggle
          checked={value.weekends}
          label="Show weekends"
          onChange={(weekends) => change({ weekends })}
        />
        <Toggle
          checked={value.allDaySlot}
          label="Show all-day area"
          onChange={(allDaySlot) => change({ allDaySlot })}
        />
        <Toggle
          checked={value.nowIndicator}
          label="Show current time"
          onChange={(nowIndicator) => change({ nowIndicator })}
        />
        <Toggle
          checked={value.showTimeEntries}
          label="Show tracked time"
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
    label: new Intl.DateTimeFormat(undefined, { hour: "numeric" }).format(
      new Date(2024, 0, 1, hour),
    ),
  }));
  if (includeMidnight) result.push({ value: "24:00:00", label: "Midnight" });
  return result;
}
