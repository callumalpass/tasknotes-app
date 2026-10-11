import {
  ArrowLeft,
  Bell,
  ChevronDown,
  ChevronRight,
  Cloud,
  Download,
  Info,
  KeyRound,
  ListChecks,
  MonitorSmartphone,
  type LucideIcon,
} from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { useEffect, useState, type ReactNode } from "react";
import { TaskNotesSelect } from "../components/tasknotes-controls";
import { ScratchpadModePreference } from "../components/scratchpad-mode-preference";
import { TaskModelSettingsEditor } from "../components/task-model-settings";
import { useUnsavedTaskModelDraft } from "../components/task-model-draft";
import { PrivateAccountSettings } from "../components/private-account-settings";
import { HeldEditsReview } from "../components/held-edits";
import { CalendarPreferencesEditor } from "../components/calendar-preferences";
import { OperationErrorNotice } from "../components/operation-error-notice";
import { SettingsSwitch } from "../components/settings-controls";
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
import { useCollectionGate } from "./collection-context";
import { changeNotificationLabel } from "./notification-label";
import { useCollectionSummary, useRepository } from "./repository-context";
import {
  settingsSectionId,
  settingsSectionLabels,
  type SettingsSection,
} from "./settings-sections";
import { storageExplanation } from "./storage-trust";
import { useNarrowLayout } from "./use-narrow-layout";
import { useStoredFlag } from "./use-stored-flag";
import type { CalendarPreferences } from "./calendar-preferences";

const sectionIcons: Record<SettingsSection, LucideIcon> = {
  collection: Cloud,
  account: KeyRound,
  reminders: Bell,
  device: MonitorSmartphone,
  behavior: ListChecks,
  about: Info,
};

export function MoreScreen({
  calendarPreferences,
  section,
  onCalendarPreferencesChange,
  onSection,
}: {
  calendarPreferences: CalendarPreferences;
  section?: SettingsSection;
  onCalendarPreferencesChange(value: CalendarPreferences): void;
  onSection(section: SettingsSection | undefined, replace?: boolean): void;
}) {
  const narrow = useNarrowLayout();
  const { info, stats, loading } = useCollectionSummary();
  const { connection, repository, privateAccount } = useRepository();
  const reminders = useReminderSettings();
  const install = useInstallPrompt();
  const unsavedBehavior = useUnsavedTaskModelDraft(repository);
  const sections: SettingsSection[] = [
    "collection",
    ...(privateAccount ? (["account"] as const) : []),
    "reminders",
    "device",
    "behavior",
    "about",
  ];
  const current = section && sections.includes(section) ? section : undefined;

  // Desktop shows every section, so a section route scrolls to it.
  useEffect(() => {
    if (narrow || !current) return;
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(settingsSectionId(current));
      target?.scrollIntoView({ block: "start" });
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [current, narrow]);

  const summaries: Record<SettingsSection, ReactNode> = {
    collection: [
      info?.name ?? "mdbase collection",
      connectionLabel(connection),
      loading || !stats ? null : `${stats.open} open`,
    ]
      .filter(Boolean)
      .join(" · "),
    account: "Private collection recovery",
    reminders: reminders.label,
    device: "Theme, Scratchpad, and calendar",
    behavior: unsavedBehavior ? (
      <span className="settings-unsaved">Unsaved changes</span>
    ) : (
      "New tasks, repeating tasks, and archive"
    ),
    about: `Version ${__APP_VERSION__}`,
  };

  const panels: Record<SettingsSection, () => ReactNode> = {
    collection: () => <CollectionSettings />,
    account: () =>
      privateAccount ? (
        <PrivateAccountSettings account={privateAccount} />
      ) : null,
    reminders: () => <ReminderSettings reminders={reminders} />,
    device: () => (
      <DeviceSettings
        calendarPreferences={calendarPreferences}
        onCalendarPreferencesChange={onCalendarPreferencesChange}
      />
    ),
    behavior: () => <TaskModelSettingsEditor />,
    about: () => <AboutSettings install={install} />,
  };

  if (narrow && current) {
    return (
      <section
        className="screen settings-screen settings-detail"
        aria-labelledby="settings-title"
      >
        <header className="screen-header compact-header settings-detail-header">
          <button
            aria-label="Back to Settings"
            className="back-action"
            type="button"
            onClick={() => onSection(undefined, true)}
          >
            <ArrowLeft aria-hidden="true" size={22} strokeWidth={1.7} />
          </button>
          <h1 id="settings-title">{settingsSectionLabels[current]}</h1>
        </header>
        <SettingsPanel section={current} titled={false}>
          {panels[current]()}
        </SettingsPanel>
      </section>
    );
  }

  return (
    <section
      className="screen settings-screen"
      aria-labelledby="settings-title"
    >
      <header className="screen-header compact-header">
        <h1 id="settings-title">Settings</h1>
      </header>
      <InstallBanner install={install} />
      {narrow ? (
        <nav aria-label="Settings sections" className="settings-overview">
          <ul>
            {sections.map((key) => {
              const Icon = sectionIcons[key];
              return (
                <li key={key}>
                  <button type="button" onClick={() => onSection(key)}>
                    <Icon aria-hidden="true" size={20} strokeWidth={1.6} />
                    <span>
                      <strong>{settingsSectionLabels[key]}</strong>
                      <small>{summaries[key]}</small>
                    </span>
                    <ChevronRight aria-hidden="true" size={18} />
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : (
        <div className="settings-layout">
          <SettingsIndex
            current={current}
            sections={sections}
            unsavedBehavior={unsavedBehavior}
            onSection={(key) => onSection(key, true)}
          />
          <div className="settings-panels">
            {sections.map((key) => (
              <SettingsPanel key={key} section={key}>
                {panels[key]()}
              </SettingsPanel>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function SettingsIndex({
  current,
  sections,
  unsavedBehavior,
  onSection,
}: {
  current?: SettingsSection;
  sections: SettingsSection[];
  unsavedBehavior: boolean;
  onSection(section: SettingsSection): void;
}) {
  const [visible, setVisible] = useState<SettingsSection | undefined>(current);
  const sectionKeys = sections.join(" ");
  useEffect(() => {
    if (typeof IntersectionObserver !== "function") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((entry) => entry.isIntersecting)
          .sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
          )[0];
        if (top)
          setVisible(
            top.target.id.replace(/^settings-/, "") as SettingsSection,
          );
      },
      { rootMargin: "0px 0px -70% 0px" },
    );
    for (const key of sectionKeys.split(" ")) {
      const element = document.getElementById(
        settingsSectionId(key as SettingsSection),
      );
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [sectionKeys]);
  const active = visible ?? current ?? sections[0];
  return (
    <nav aria-label="Settings sections" className="settings-index">
      <ul>
        {sections.map((key) => (
          <li key={key}>
            <a
              aria-current={active === key ? "location" : undefined}
              href={`#${settingsSectionId(key)}`}
              onClick={(event) => {
                event.preventDefault();
                setVisible(key);
                onSection(key);
                // Navigation resets scroll; return to the section even when
                // the route already names it.
                requestAnimationFrame(() =>
                  document
                    .getElementById(settingsSectionId(key))
                    ?.scrollIntoView({ block: "start" }),
                );
              }}
            >
              {settingsSectionLabels[key]}
              {key === "behavior" && unsavedBehavior ? (
                <span className="settings-unsaved-dot" title="Unsaved changes">
                  <span className="visually-hidden"> (unsaved changes)</span>
                </span>
              ) : null}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

const sectionScopes: Partial<Record<SettingsSection, string>> = {
  device: "This device only",
  behavior: "Shared with everyone using this collection",
};

function SettingsPanel({
  section,
  titled = true,
  children,
}: {
  section: SettingsSection;
  titled?: boolean;
  children: ReactNode;
}) {
  const id = settingsSectionId(section);
  const scope = sectionScopes[section];
  return (
    <section
      aria-labelledby={titled ? `${id}-title` : "settings-title"}
      className={`settings-section settings-section-${section}`}
      id={id}
      tabIndex={-1}
    >
      {titled ? (
        <header className="settings-section-header">
          <h2 id={`${id}-title`}>{settingsSectionLabels[section]}</h2>
          {scope ? <span className="settings-scope">{scope}</span> : null}
        </header>
      ) : scope ? (
        <p className="settings-scope">{scope}</p>
      ) : null}
      <div className="settings-content">{children}</div>
    </section>
  );
}

function CollectionSettings() {
  const { info, stats, loading } = useCollectionSummary();
  const { connection, lastRefresh, refresh, refreshing } = useRepository();
  const { changeCollection } = useCollectionGate();
  const [showStorage, setShowStorage] = useStoredFlag(
    "tasknotes:settings-storage-open:v1",
    false,
  );
  return (
    <>
      <div className="settings-collection-card">
        <div className="settings-collection-identity">
          <strong>{info?.name ?? "mdbase collection"}</strong>
          <span
            className={`settings-connection is-${connection.state}`}
            role="status"
          >
            <span aria-hidden="true" className="settings-connection-dot" />
            <span>{connectionLabel(connection)}</span>
            {loading ? (
              <span>· Opening</span>
            ) : stats ? (
              <span>
                · {stats.open} open · {stats.total} total
              </span>
            ) : null}
          </span>
        </div>
        {connection.message ? (
          <p className="section-copy" role="status">
            {connection.message}
          </p>
        ) : null}
        {connection.sync ? (
          <p className="section-copy" role="status">
            {connection.sync.text}
            {connection.sync.pending > 0
              ? ". Pending edits are not yet synced."
              : null}
          </p>
        ) : null}
        <div className="settings-actions">
          <button
            className="secondary-action"
            disabled={refreshing}
            type="button"
            onClick={() => void refresh().catch(() => undefined)}
          >
            {refreshing ? "Refreshing" : "Refresh now"}
          </button>
          <button
            className="secondary-action"
            type="button"
            onClick={changeCollection}
          >
            Change collection
          </button>
        </div>
      </div>
      {connection.heldEdits?.length ? (
        <div className="settings-group">
          <h3>Protected edits</h3>
          <HeldEditsReview edits={connection.heldEdits} />
        </div>
      ) : null}
      <button
        aria-expanded={showStorage}
        className="setting-explanation"
        type="button"
        onClick={() => setShowStorage(!showStorage)}
      >
        <span>How tasks are stored</span>
        <ChevronDown
          aria-hidden="true"
          className={showStorage ? "is-open" : undefined}
          size={17}
        />
      </button>
      {showStorage ? (
        <div className="collection-storage-detail">
          <p className="section-copy">{storageExplanation()}</p>
          <p className="section-copy">
            Tasks are portable Markdown records in the mdbase v0.3 format.
          </p>
          {info ? (
            <code className="collection-path">{info.location}</code>
          ) : null}
          {lastRefresh ? (
            <p className="refresh-detail">
              Last refresh checked {lastRefresh.scanned.toLocaleString()}{" "}
              records in {lastRefresh.elapsedMs.toLocaleString()} ms.
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

type ReminderSettingsState = ReturnType<typeof useReminderSettings>;

function useReminderSettings() {
  const { reminderAuthority } = useRepository();
  const delivers = reminderAuthority !== "none";
  const [status, setStatus] = useState<MdbaseNotificationStatus>({
    state: "checking",
    optedIn: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!delivers) return;
    let active = true;
    void mdbaseNotifications
      .status()
      .then((next) => {
        if (active) setStatus(next);
      })
      .catch((reason: unknown) => {
        if (active) {
          setStatus({ state: "error", optedIn: false });
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });
    return () => {
      active = false;
    };
  }, [delivers]);

  async function setEnabled(enabled: boolean) {
    if (!delivers) return;
    setBusy(true);
    setError(null);
    try {
      setStatus(
        enabled
          ? await mdbaseNotifications.enable()
          : await mdbaseNotifications.disable(),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  function reviewAccess() {
    void cloudSession
      .authorize("selected", { presentation: "popup" })
      .then(requireConnectOutcome)
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      );
  }

  return {
    delivers,
    status,
    busy,
    error,
    label: delivers ? changeNotificationLabel(status) : "Not available",
    setEnabled,
    reviewAccess,
  };
}

function ReminderSettings({ reminders }: { reminders: ReminderSettingsState }) {
  const { delivers, status, busy, error } = reminders;
  if (!delivers)
    return (
      <div className="settings-status-row">
        <span>Task reminders</span>
        <small>{reminders.label}</small>
        <p className="setting-hint">
          Reminder details are saved on tasks, but this version of TaskNotes
          does not send reminder notifications.
        </p>
      </div>
    );
  const switchable =
    status.state === "off" ||
    status.state === "enabled" ||
    (status.state === "denied" && status.optedIn);
  const description =
    "mdbase delivers reminders while TaskNotes is closed. Notifications never include task content.";
  return (
    <>
      {switchable ? (
        <SettingsSwitch
          busy={busy}
          checked={status.optedIn}
          description={
            status.state === "denied"
              ? "Notifications are turned off for TaskNotes in system settings. Turn them on there to receive reminders."
              : description
          }
          label="Task reminders"
          onChange={(enabled) => void reminders.setEnabled(enabled)}
        />
      ) : (
        <div className="settings-status-row">
          <span>Task reminders</span>
          <small role="status">{reminders.label}</small>
          <p className="setting-hint">{description}</p>
        </div>
      )}
      {status.state === "reauthorization_required" ? (
        <div className="settings-actions">
          <button
            className="secondary-action"
            type="button"
            onClick={reminders.reviewAccess}
          >
            Review notification access
          </button>
        </div>
      ) : null}
      {error ? (
        <OperationErrorNotice
          action="Reminder setup"
          message={error}
          recovery="Check that the collection is connected, then try again."
        />
      ) : null}
    </>
  );
}

function DeviceSettings({
  calendarPreferences,
  onCalendarPreferencesChange,
}: {
  calendarPreferences: CalendarPreferences;
  onCalendarPreferencesChange(value: CalendarPreferences): void;
}) {
  return (
    <>
      <p className="section-copy">
        These choices apply as soon as you make them and don’t change the
        collection.
      </p>
      <div className="settings-group">
        <h3>Appearance</h3>
        <div className="setting-row">
          <span>Color theme</span>
          <ThemeSelect />
        </div>
      </div>
      <div className="settings-group">
        <h3>Scratchpad</h3>
        <div className="setting-row">
          <span>Default mode for new notes</span>
          <ScratchpadModePreference />
        </div>
      </div>
      <div className="settings-group">
        <h3>Calendar</h3>
        <CalendarPreferencesEditor
          value={calendarPreferences}
          onChange={onCalendarPreferencesChange}
        />
      </div>
    </>
  );
}

type InstallPrompt = ReturnType<typeof useInstallPrompt>;

function useInstallPrompt() {
  const installState = usePwaInstall();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const [dismissed, setDismissed] = useStoredFlag(
    "tasknotes:install-banner-dismissed:v1",
    false,
  );
  const available =
    !Capacitor.isNativePlatform() &&
    (installState === "available" || installState === "ios-instructions");

  async function install() {
    if (installState === "ios-instructions") {
      setShowInstructions((visible) => !visible);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await requestPwaInstall();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "TaskNotes could not open the install prompt.",
      );
    } finally {
      setBusy(false);
    }
  }

  return {
    available,
    busy,
    error,
    dismissed,
    dismiss: () => setDismissed(true),
    showInstructions,
    instructionsOnly: installState === "ios-instructions",
    install,
  };
}

function InstallAction({ install }: { install: InstallPrompt }) {
  return (
    <>
      <button
        className="secondary-action"
        disabled={install.busy}
        type="button"
        onClick={() => void install.install()}
      >
        <Download aria-hidden="true" size={17} />
        {install.busy
          ? "Opening install prompt…"
          : install.instructionsOnly
            ? install.showInstructions
              ? "Hide installation steps"
              : "How to install"
            : "Install app"}
      </button>
    </>
  );
}

function InstallFeedback({ install }: { install: InstallPrompt }) {
  return (
    <>
      {install.showInstructions ? (
        <p className="section-copy" role="status">
          Open your browser’s Share menu, then choose Add to Home Screen.
        </p>
      ) : null}
      {install.error ? (
        <p className="inline-error" role="alert">
          {install.error}
        </p>
      ) : null}
    </>
  );
}

function InstallBanner({ install }: { install: InstallPrompt }) {
  if (!install.available || install.dismissed) return null;
  return (
    <aside aria-label="Install TaskNotes" className="settings-banner">
      <p>Install TaskNotes to open it from your home screen.</p>
      <div className="settings-actions">
        <InstallAction install={install} />
        <button className="text-action" type="button" onClick={install.dismiss}>
          Not now
        </button>
      </div>
      <InstallFeedback install={install} />
    </aside>
  );
}

function AboutSettings({ install }: { install: InstallPrompt }) {
  return (
    <>
      <div className="setting-row">
        <span>TaskNotes</span>
        <small>Version {__APP_VERSION__}</small>
      </div>
      {install.available ? (
        <>
          <div className="setting-row">
            <span>Install on this device</span>
            <InstallAction install={install} />
          </div>
          {install.dismissed ? <InstallFeedback install={install} /> : null}
        </>
      ) : null}
      <div className="settings-group">
        <h3>Help</h3>
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
            Yes. Use Change collection under Collection to open another mdbase
            collection. Changing collections does not move records between them.
          </p>
        </details>
      </div>
    </>
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
