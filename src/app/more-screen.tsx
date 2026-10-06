import { useLingui, Trans } from "@lingui/react/macro";
import {
  ChevronDown,
  Download,
  FileText,
  Info,
  Bell,
  SunMoon,
} from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { useEffect, useState } from "react";
import { TaskNotesSelect } from "../components/tasknotes-controls";
import { ScratchpadModePreference } from "../components/scratchpad-mode-preference";
import { TaskModelSettingsEditor } from "../components/task-model-settings";
import { CalendarPreferencesEditor } from "../components/calendar-preferences";
import {
  mdbaseNotifications,
  type MdbaseNotificationStatus,
} from "../native/mdbase-notifications";
import { cloudSession } from "../cloud/connect";
import { requireConnectOutcome } from "../cloud/outcome";
import { requestPwaInstall, usePwaInstall } from "../pwa/install";
import {
  applyThemePreference,
  loadThemePreference,
  saveThemePreference,
  type ThemePreference,
} from "../theme";
import { CollectionSettings } from "./collection-settings";
import { changeNotificationLabel } from "./notification-label";
import { useRepository } from "./repository-context";
import { storageExplanation } from "./storage-trust";
import type { CalendarPreferences } from "./calendar-preferences";

export function MoreScreen({
  calendarPreferences,
  onCalendarPreferencesChange,
}: {
  calendarPreferences: CalendarPreferences;
  onCalendarPreferencesChange(value: CalendarPreferences): void;
}) {
  const { t } = useLingui();
  const { reminderAuthority } = useRepository();
  const deliversReminders = reminderAuthority !== "none";
  const [changeNotifications, setChangeNotifications] =
    useState<MdbaseNotificationStatus>({
      state: "checking",
      optedIn: false,
    });
  const [changeNotificationsBusy, setChangeNotificationsBusy] = useState(false);
  const [changeNotificationsError, setChangeNotificationsError] = useState<
    string | null
  >(null);
  const installState = usePwaInstall();
  const [installBusy, setInstallBusy] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [showInstallInstructions, setShowInstallInstructions] = useState(false);
  const installAvailable =
    !Capacitor.isNativePlatform() &&
    (installState === "available" || installState === "ios-instructions");
  useEffect(() => {
    let active = true;
    void mdbaseNotifications
      .status()
      .then((next) => {
        if (active) setChangeNotifications(next);
      })
      .catch((reason: unknown) => {
        if (active) {
          setChangeNotifications({ state: "error", optedIn: false });
          setChangeNotificationsError(
            reason instanceof Error ? reason.message : String(reason),
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function installTaskNotes() {
    if (installState === "ios-instructions") {
      setShowInstallInstructions((visible) => !visible);
      return;
    }
    setInstallBusy(true);
    setInstallError(null);
    try {
      await requestPwaInstall();
    } catch (reason) {
      setInstallError(
        reason instanceof Error
          ? reason.message
          : t({ message: "TaskNotes could not open the install prompt." }),
      );
    } finally {
      setInstallBusy(false);
    }
  }

  async function toggleChangeNotifications() {
    setChangeNotificationsBusy(true);
    setChangeNotificationsError(null);
    try {
      const next = changeNotifications.optedIn
        ? await mdbaseNotifications.disable()
        : await mdbaseNotifications.enable();
      setChangeNotifications(next);
    } catch (reason) {
      setChangeNotificationsError(
        reason instanceof Error ? reason.message : String(reason),
      );
    } finally {
      setChangeNotificationsBusy(false);
    }
  }

  return (
    <section
      className="screen settings-screen"
      aria-labelledby="settings-title"
    >
      <header className="screen-header compact-header">
        <h1 id="settings-title">
          <Trans>Settings</Trans>
        </h1>
      </header>
      <CollectionSettings />

      <SettingsSection label={t({ message: "Notifications" })}>
        <div className="setting-row">
          <Bell aria-hidden="true" size={20} strokeWidth={1.6} />
          <span>
            <Trans>Task reminders</Trans>
          </span>
          <small>
            {deliversReminders
              ? changeNotificationLabel(changeNotifications)
              : t({ message: "Not in the demo" })}
          </small>
        </div>
        <p className="section-copy">
          {deliversReminders
            ? t({
                message:
                  "mdbase delivers reminders while TaskNotes is closed. Notifications never include task content.",
              })
            : t({
                message:
                  "The demo keeps reminder details on tasks but doesn’t send notifications. Connect a collection to receive them.",
              })}
        </p>
        {changeNotifications.state === "off" ||
        changeNotifications.state === "enabled" ||
        (changeNotifications.state === "denied" &&
          changeNotifications.optedIn) ? (
          <button
            className="text-action"
            disabled={changeNotificationsBusy}
            type="button"
            onClick={() => void toggleChangeNotifications()}
          >
            {changeNotificationsBusy
              ? t({ message: "Updating" })
              : changeNotifications.optedIn
                ? t({ message: "Turn off reminders" })
                : t({ message: "Turn on reminders" })}
          </button>
        ) : null}
        {changeNotifications.state === "reauthorization_required" ? (
          <button
            className="text-action"
            type="button"
            onClick={() =>
              void cloudSession
                .authorize("selected", { presentation: "popup" })
                .then(requireConnectOutcome)
                .catch((reason: unknown) =>
                  setChangeNotificationsError(
                    reason instanceof Error ? reason.message : String(reason),
                  ),
                )
            }
          >
            <Trans>Review notification access</Trans>
          </button>
        ) : null}
        {changeNotificationsError ? (
          <p className="inline-error" role="alert">
            {changeNotificationsError}
          </p>
        ) : null}
      </SettingsSection>

      <SettingsSection label={t({ message: "Appearance" })}>
        <div className="setting-row">
          <SunMoon aria-hidden="true" size={20} strokeWidth={1.6} />
          <span>
            <Trans>Color theme</Trans>
          </span>
          <ThemeSelect />
        </div>
      </SettingsSection>

      <SettingsSection label={t({ message: "Scratchpad" })}>
        <div className="setting-row">
          <FileText aria-hidden="true" size={20} strokeWidth={1.6} />
          <span>
            <Trans>Default mode for new notes</Trans>
          </span>
          <ScratchpadModePreference />
        </div>
      </SettingsSection>

      <SettingsSection label={t({ message: "Calendar" })}>
        <CalendarPreferencesEditor
          value={calendarPreferences}
          onChange={onCalendarPreferencesChange}
        />
      </SettingsSection>

      <SettingsSection label={t({ message: "About & portability" })}>
        {installAvailable ? (
          <>
            <div className="setting-row">
              <Download aria-hidden="true" size={20} strokeWidth={1.6} />
              <span>
                <Trans>Install TaskNotes</Trans>
              </span>
              <small>
                <Trans>Open it from your home screen</Trans>
              </small>
            </div>
            <button
              className="text-action"
              disabled={installBusy}
              type="button"
              onClick={() => void installTaskNotes()}
            >
              {installBusy
                ? t({ message: "Opening install prompt…" })
                : installState === "ios-instructions"
                  ? showInstallInstructions
                    ? t({ message: "Hide installation steps" })
                    : t({ message: "How to install" })
                  : t({ message: "Install app" })}
            </button>
            {showInstallInstructions ? (
              <p className="section-copy" role="status">
                <Trans>
                  Open your browser’s Share menu, then choose Add to Home
                  Screen.
                </Trans>
              </p>
            ) : null}
            {installError ? (
              <p className="inline-error" role="alert">
                {installError}
              </p>
            ) : null}
          </>
        ) : null}
        <div className="setting-row">
          <FileText aria-hidden="true" size={20} strokeWidth={1.6} />
          <span>
            <Trans>Portable Markdown</Trans>
          </span>
          <small>
            <Trans>mdbase v0.3</Trans>
          </small>
        </div>
        <p className="section-copy">
          <Trans>Tasks remain portable Markdown records.</Trans>
        </p>
        <div className="setting-row">
          <Info aria-hidden="true" size={20} strokeWidth={1.6} />
          <span>TaskNotes</span>
          <small>
            <Trans>Version {__APP_VERSION__}</Trans>
          </small>
        </div>
      </SettingsSection>

      <SettingsSection collapsible label={t({ message: "Task model" })}>
        <TaskModelSettingsEditor />
      </SettingsSection>

      <SettingsSection collapsible label={t({ message: "Help" })}>
        <details className="help-topic">
          <summary>
            <Trans>Where are my tasks saved?</Trans>
          </summary>
          <p>{storageExplanation()}</p>
        </details>
        <details className="help-topic">
          <summary>
            <Trans>Does TaskNotes work offline?</Trans>
          </summary>
          <p>
            <Trans>
              No. TaskNotes reads and writes the authoritative mdbase collection
              directly. Hosted collections need a network connection; a computer
              collection also needs that computer to be reachable.
            </Trans>
          </p>
        </details>
        <details className="help-topic">
          <summary>
            <Trans>Can I change collections later?</Trans>
          </summary>
          <p>
            <Trans>
              Yes. Use Collection above to open another mdbase collection.
              Changing collections does not move records between them.
            </Trans>
          </p>
        </details>
      </SettingsSection>
    </section>
  );
}

function ThemeSelect() {
  const { t } = useLingui();
  const [preference, setPreference] =
    useState<ThemePreference>(loadThemePreference);
  useEffect(() => {
    applyThemePreference(preference);
    if (preference !== "system" || typeof window.matchMedia !== "function")
      return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => applyThemePreference("system");
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [preference]);
  return (
    <TaskNotesSelect
      ariaLabel={t({ message: "Color theme" })}
      className="theme-picker"
      options={[
        { value: "system", label: t({ message: "System" }) },
        { value: "light", label: t({ message: "Light" }) },
        { value: "dark", label: t({ message: "Dark" }) },
      ]}
      value={preference}
      onChange={(value) => {
        const next = value as ThemePreference;
        setPreference(next);
        saveThemePreference(next);
      }}
    />
  );
}

function SettingsSection({
  label,
  children,
  collapsible = false,
}: {
  label: string;
  children: React.ReactNode;
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!collapsible)
    return (
      <section className="settings-section">
        <h2>{label}</h2>
        <div className="settings-content">{children}</div>
      </section>
    );
  return (
    <details
      className="settings-section settings-disclosure"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <h2>{label}</h2>
        <ChevronDown aria-hidden="true" size={17} strokeWidth={1.7} />
      </summary>
      <div className="settings-content">{children}</div>
    </details>
  );
}
