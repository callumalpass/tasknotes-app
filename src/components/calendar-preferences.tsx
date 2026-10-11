import {
  orderedWeekdays,
  type CalendarPreferences,
} from "../app/calendar-preferences";
import { SettingsSwitch } from "./settings-controls";
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
      <div className="settings-switch-list">
        <SettingsSwitch
          checked={value.weekends}
          label="Show weekends"
          onChange={(weekends) => change({ weekends })}
        />
        <SettingsSwitch
          checked={value.allDaySlot}
          label="Show all-day area"
          onChange={(allDaySlot) => change({ allDaySlot })}
        />
        <SettingsSwitch
          checked={value.nowIndicator}
          label="Show current time"
          onChange={(nowIndicator) => change({ nowIndicator })}
        />
        <SettingsSwitch
          checked={value.showTimeEntries}
          label="Show tracked time"
          onChange={(showTimeEntries) => change({ showTimeEntries })}
        />
      </div>
    </div>
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
