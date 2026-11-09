import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { appLocale } from "../i18n/app";
import {
  orderedWeekdays,
  type CalendarPreferences,
} from "../app/calendar-preferences";

/** Slot heights offered in settings; a pinched height joins them while chosen. */
const SLOT_HEIGHTS = [24, 36, 56, 80];
import { SettingsSwitch } from "./settings-controls";
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
        <TaskNotesSelectField
          label={t({ message: "Time slot height" })}
          options={[
            {
              value: "",
              label: t({
                message: "View default",
                comment: "Slot height option that follows the calendar view",
              }),
            },
            ...[
              ...new Set([
                ...SLOT_HEIGHTS,
                ...(value.slotHeight === undefined ? [] : [value.slotHeight]),
              ]),
            ]
              .sort((a, b) => a - b)
              .map((height) => ({
                value: String(height),
                label: `${new Intl.NumberFormat(appLocale()).format(height)} px`,
              })),
          ]}
          value={value.slotHeight === undefined ? "" : String(value.slotHeight)}
          onChange={(height) =>
            change({ slotHeight: height ? Number(height) : undefined })
          }
        />
      </div>
      <div className="settings-switch-list">
        <SettingsSwitch
          checked={value.weekends}
          label={t({ message: "Show weekends" })}
          onChange={(weekends) => change({ weekends })}
        />
        <SettingsSwitch
          checked={value.allDaySlot}
          label={t({ message: "Show all-day area" })}
          onChange={(allDaySlot) => change({ allDaySlot })}
        />
        <SettingsSwitch
          checked={value.nowIndicator}
          label={t({ message: "Show current time" })}
          onChange={(nowIndicator) => change({ nowIndicator })}
        />
        <SettingsSwitch
          checked={value.pinchZoom}
          label={t({ message: "Pinch to resize time slots" })}
          onChange={(pinchZoom) => change({ pinchZoom })}
        />
        <SettingsSwitch
          checked={value.showTimeEntries}
          label={t({ message: "Show tracked time" })}
          onChange={(showTimeEntries) => change({ showTimeEntries })}
        />
      </div>
    </div>
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
