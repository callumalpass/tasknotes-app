import {
  ChevronDown,
  ChevronUp,
  Cloud,
  FileText,
  Info,
  Bell,
  Plus,
  SunMoon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { TaskNotesSelect } from "../components/tasknotes-controls";
import { TaskModelSettingsEditor } from "../components/task-model-settings";
import {
  mdbaseNotifications,
  type MdbaseNotificationStatus,
} from "../native/mdbase-notifications";
import { cloudSession } from "../cloud/connect";
import { requireConnectOutcome } from "../cloud/outcome";
import {
  applyThemePreference,
  loadThemePreference,
  saveThemePreference,
  type ThemePreference,
} from "../theme";
import { useCollectionGate } from "./collection-context";
import { changeNotificationLabel } from "./notification-label";
import { useCollectionSummary, useRepository } from "./repository-context";
import { storageExplanation } from "./storage-trust";

export function MoreScreen({ onNewTask }: { onNewTask(): void }) {
  const { info, stats, loading } = useCollectionSummary();
  const { connection, lastRefresh, refresh, refreshing } = useRepository();
  const { changeCollection } = useCollectionGate();
  const [showLocation, setShowLocation] = useState(false);
  const [changeNotifications, setChangeNotifications] =
    useState<MdbaseNotificationStatus>({
      state: "checking",
      optedIn: false,
    });
  const [changeNotificationsBusy, setChangeNotificationsBusy] = useState(false);
  const [changeNotificationsError, setChangeNotificationsError] = useState<
    string | null
  >(null);
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
        <h1 id="settings-title">Settings</h1>
        <button
          aria-label="New task"
          className="icon-action more-new-task"
          title="New task"
          type="button"
          onClick={onNewTask}
        >
          <Plus aria-hidden="true" size={20} strokeWidth={1.7} />
        </button>
      </header>
      <SettingsSection label="Collection">
        <div className="setting-row">
          <Cloud aria-hidden="true" size={20} strokeWidth={1.6} />
          <span>{info?.name ?? "mdbase collection"}</span>
          <small>
            {loading
              ? "Opening"
              : `${stats?.open ?? 0} open · ${stats?.total ?? 0} total`}
          </small>
        </div>
        <button
          className="setting-explanation"
          type="button"
          onClick={() => setShowLocation((value) => !value)}
        >
          <span>{storageExplanation()}</span>
          {showLocation ? (
            <ChevronUp aria-hidden="true" size={17} />
          ) : (
            <ChevronDown aria-hidden="true" size={17} />
          )}
        </button>
        {showLocation && info ? (
          <code className="collection-path">{info.location}</code>
        ) : null}
        <button
          className="text-action"
          disabled={refreshing}
          type="button"
          onClick={() => void refresh()}
        >
          {refreshing ? "Refreshing" : "Refresh now"}
        </button>
        {lastRefresh ? (
          <p className="refresh-detail">
            {lastRefresh.scanned.toLocaleString()} records checked in{" "}
            {lastRefresh.elapsedMs.toLocaleString()} ms.
          </p>
        ) : null}
        <div className="settings-subsection">
          <h3>Connection</h3>
          <div className="setting-row">
            <Cloud aria-hidden="true" size={20} strokeWidth={1.6} />
            <span>mdbase</span>
            <small>{connectionLabel(connection)}</small>
          </div>
          {connection.message ? (
            <p className="section-copy" role="status">
              {connection.message}
            </p>
          ) : null}
          <div className="cloud-actions">
            <button
              className="text-action"
              type="button"
              onClick={changeCollection}
            >
              Change collection
            </button>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection label="Notifications">
        <div className="setting-row">
          <Bell aria-hidden="true" size={20} strokeWidth={1.6} />
          <span>Task reminders</span>
          <small>{changeNotificationLabel(changeNotifications)}</small>
        </div>
        <p className="section-copy">
          mdbase keeps reminders running when TaskNotes is closed. Notification
          text never includes task content.
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
              ? "Updating"
              : changeNotifications.optedIn
                ? "Turn off reminders"
                : "Turn on reminders"}
          </button>
        ) : null}
        {changeNotifications.state === "reauthorization_required" ? (
          <button
            className="text-action"
            type="button"
            onClick={() =>
              void cloudSession
                .authorize("selected")
                .then(requireConnectOutcome)
                .catch((reason: unknown) =>
                  setChangeNotificationsError(
                    reason instanceof Error ? reason.message : String(reason),
                  ),
                )
            }
          >
            Review notification access
          </button>
        ) : null}
        {changeNotificationsError ? (
          <p className="inline-error" role="alert">
            {changeNotificationsError}
          </p>
        ) : null}
      </SettingsSection>

      <SettingsSection label="Appearance">
        <div className="setting-row">
          <SunMoon aria-hidden="true" size={20} strokeWidth={1.6} />
          <span>Color theme</span>
          <ThemeSelect />
        </div>
      </SettingsSection>

      <SettingsSection label="About & portability">
        <div className="setting-row">
          <FileText aria-hidden="true" size={20} strokeWidth={1.6} />
          <span>Portable Markdown</span>
          <small>mdbase v0.3</small>
        </div>
        <p className="section-copy">
          Tasks are ordinary Markdown records. Field mappings and TaskNotes
          settings travel with the collection.
        </p>
        <div className="setting-row">
          <Info aria-hidden="true" size={20} strokeWidth={1.6} />
          <span>TaskNotes</span>
          <small>Version 0.1.0</small>
        </div>
      </SettingsSection>

      <SettingsSection collapsible label="Advanced">
        <TaskModelSettingsEditor />
      </SettingsSection>

      <SettingsSection collapsible label="Help">
        <details className="help-topic">
          <summary>Where are my tasks saved?</summary>
          <p>{storageExplanation()}</p>
        </details>
        <details className="help-topic">
          <summary>Does TaskNotes work offline?</summary>
          <p>
            No. TaskNotes reads and writes the authoritative mdbase collection
            directly. Hosted collections need a network connection; a computer
            collection also needs that computer to be reachable.
          </p>
        </details>
        <details className="help-topic">
          <summary>Can I change collections later?</summary>
          <p>
            Yes. Use Collection above to open another mdbase collection.
            Changing collections does not move records between them.
          </p>
        </details>
      </SettingsSection>
    </section>
  );
}

function ThemeSelect() {
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
      ariaLabel="Color theme"
      className="theme-picker"
      options={[
        { value: "system", label: "System" },
        { value: "light", label: "Light" },
        { value: "dark", label: "Dark" },
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

function connectionLabel(
  connection: ReturnType<typeof useRepository>["connection"],
): string {
  if (connection.state === "connecting") return "Connecting";
  if (connection.state === "unavailable") return "Collection unavailable";
  return "Connected";
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
