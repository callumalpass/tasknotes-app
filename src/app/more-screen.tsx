import { t as translate, plural } from "@lingui/core/macro";
import { useLingui, Trans } from "@lingui/react/macro";
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
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { LanguageSettings } from "../i18n/language-settings";
import { TaskNotesSelect } from "../components/tasknotes-controls";
import { ScratchpadModePreference } from "../components/scratchpad-mode-preference";
import { TaskModelSettingsEditor } from "../components/task-model-settings";
import { useUnsavedTaskModelDraft } from "../components/task-model-draft";
import { PrivateAccountSettings } from "../components/private-account-settings";
import { HeldEditsReview } from "../components/held-edits";
import { CalendarPreferencesEditor } from "../components/calendar-preferences";
import { OperationErrorNotice } from "../components/operation-error-notice";
import { SettingsSwitch } from "../components/settings-controls";
import type { MdbaseNotificationStatus } from "../native/mdbase-notifications";
import { requestPwaInstall, usePwaInstall } from "../pwa/install";
import {
  applyThemePreference,
  loadThemePreference,
  saveThemePreference,
  type ThemePreference,
} from "../theme";
import { CollectionSwitcher } from "@mdbase-dev/ui/collections";
import {
  ConnectionNoticeContext,
  connectionNoticeLabels,
  type ConnectionNotice,
} from "./connection-notice";
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
  const notice = useContext(ConnectionNoticeContext);
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
      target?.scrollIntoView?.({ block: "start" });
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [current, narrow]);

  const summaries: Record<SettingsSection, ReactNode> = {
    collection: [
      info?.name ?? translate({ message: "mdbase collection" }),
      connectionLabel(connection, notice),
      loading || !stats
        ? null
        : plural(stats.open, {
            one: "# open",
            other: "# open",
          }),
    ]
      .filter(Boolean)
      .join(" · "),
    account: translate({ message: "Private collection recovery" }),
    reminders: reminders.label,
    device: translate({ message: "Theme, Scratchpad, and calendar" }),
    behavior: unsavedBehavior ? (
      <span className="settings-unsaved">
        <Trans>Unsaved changes</Trans>
      </span>
    ) : (
      translate({ message: "New tasks, repeating tasks, and archive" })
    ),
    about: translate`Version ${__APP_VERSION__}`,
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
            aria-label={translate({ message: "Back to Settings" })}
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
        <h1 id="settings-title">
          <Trans>Settings</Trans>
        </h1>
      </header>
      <InstallBanner install={install} />
      {narrow ? (
        <nav
          aria-label={translate({ message: "Settings sections" })}
          className="settings-overview"
        >
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
    <nav
      aria-label={translate({ message: "Settings sections" })}
      className="settings-index"
    >
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
                    ?.scrollIntoView?.({ block: "start" }),
                );
              }}
            >
              {settingsSectionLabels[key]}
              {key === "behavior" && unsavedBehavior ? (
                <span
                  className="settings-unsaved-dot"
                  title={translate({ message: "Unsaved changes" })}
                >
                  <span className="visually-hidden">
                    {" "}
                    <Trans>(unsaved changes)</Trans>
                  </span>
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
  get device() {
    return translate({ message: "This device only" });
  },
  get behavior() {
    return translate({ message: "Shared with everyone using this collection" });
  },
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
  const {
    info,
    stats,
    loading,
    error: summaryError,
    retry: retrySummary,
  } = useCollectionSummary();
  const { connection, lastRefresh, refresh, refreshing } = useRepository();
  const notice = useContext(ConnectionNoticeContext);
  const { collectionUi, changeCollection } = useCollectionGate();
  const [showStorage, setShowStorage] = useStoredFlag(
    "tasknotes:settings-storage-open:v1",
    false,
  );
  return (
    <>
      <div className="settings-collection-card">
        <div className="settings-collection-identity">
          <strong>
            {info?.name ?? translate({ message: "mdbase collection" })}
          </strong>
          <span
            className={`settings-connection is-${connection.savedOnDevice || notice ? "unavailable" : connection.state}`}
            role="status"
          >
            <span aria-hidden="true" className="settings-connection-dot" />
            <span>{connectionLabel(connection, notice)}</span>
            {loading ? (
              <span>
                <Trans>· Opening</Trans>
              </span>
            ) : summaryError ? (
              <span>
                <Trans>· Details need attention</Trans>
              </span>
            ) : stats ? (
              <span>
                <Trans>
                  · {stats.open} open · {stats.total} total
                </Trans>
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
              ? translate({ message: ". Pending edits are not yet synced." })
              : null}
          </p>
        ) : null}
        {summaryError ? (
          <>
            <p className="inline-error" role="alert">
              <Trans>Collection details could not be loaded. </Trans>
              {summaryError.message}
            </p>
            <button
              className="text-action"
              type="button"
              onClick={retrySummary}
            >
              <Trans>Retry collection details</Trans>
            </button>
          </>
        ) : null}
        <div className="settings-collection-actions">
          <button
            className="secondary-action"
            disabled={refreshing}
            type="button"
            onClick={() => void refresh().catch(() => undefined)}
          >
            {refreshing
              ? translate({ message: "Refreshing" })
              : translate({ message: "Refresh now" })}
          </button>
          {collectionUi ? (
            <CollectionSwitcher {...collectionUi} variant="full" />
          ) : (
            <button
              className="secondary-action"
              type="button"
              onClick={changeCollection}
            >
              <Trans>Change collection</Trans>
            </button>
          )}
        </div>
      </div>
      {connection.heldEdits?.length ? (
        <div className="settings-group">
          <h3>
            <Trans>Protected edits</Trans>
          </h3>
          <HeldEditsReview edits={connection.heldEdits} />
        </div>
      ) : null}
      <button
        aria-expanded={showStorage}
        className="setting-explanation"
        type="button"
        onClick={() => setShowStorage(!showStorage)}
      >
        <span>
          <Trans>How tasks are stored</Trans>
        </span>
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
            <Trans>
              Tasks are portable Markdown records in the mdbase v0.3 format.
            </Trans>
          </p>
          {info ? (
            <code className="collection-path">{info.location}</code>
          ) : null}
          {lastRefresh ? (
            <p className="refresh-detail">
              <Trans>
                Last refresh checked {lastRefresh.scanned.toLocaleString()}{" "}
                records in {lastRefresh.elapsedMs.toLocaleString()} ms.
              </Trans>
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

type ReminderSettingsState = ReturnType<typeof useReminderSettings>;

function useReminderSettings() {
  const { reauthorizeCurrentCollection } = useCollectionGate();
  const { reminderAuthority } = useRepository();
  const delivers = reminderAuthority !== "none";
  const [status, setStatus] = useState<MdbaseNotificationStatus>({
    state: "checking",
    optedIn: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const busyRef = useRef(false);
  const operation = useRef(0);

  useEffect(() => {
    if (!delivers || busyRef.current) return;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    const current = ++operation.current;
    void import("../native/mdbase-notifications")
      .then(({ mdbaseNotifications }) => {
        if (!active) return;
        unsubscribe = mdbaseNotifications.subscribeStatus(() => {
          if (active && !busyRef.current) setRevision((value) => value + 1);
        });
        return mdbaseNotifications.status();
      })
      .then((next) => {
        if (next && active && current === operation.current) {
          setStatus(next);
          setError(null);
        }
      })
      .catch((reason: unknown) => {
        if (active && current === operation.current) {
          setStatus((value) => ({ ...value, state: "error" }));
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [delivers, revision]);

  useEffect(() => {
    if (!delivers) return;
    const recheck = () => {
      if (!busyRef.current) setRevision((value) => value + 1);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") recheck();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const listener = Capacitor.isNativePlatform()
      ? App.addListener("appStateChange", ({ isActive }) => {
          if (isActive) recheck();
        }).catch(() => null)
      : null;
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      void listener?.then((handle) => handle?.remove()).catch(() => undefined);
    };
  }, [delivers]);

  const retry = useCallback(() => {
    if (busyRef.current) return;
    setStatus((value) => ({ ...value, state: "checking" }));
    setError(null);
    setRevision((value) => value + 1);
  }, []);

  async function setEnabled(enabled: boolean) {
    if (!delivers || busyRef.current) return;
    // An older passive check must not overwrite explicit enable/disable results.
    operation.current += 1;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const { mdbaseNotifications } =
        await import("../native/mdbase-notifications");
      setStatus(
        enabled
          ? await mdbaseNotifications.enable()
          : await mdbaseNotifications.disable(),
      );
    } catch (reason) {
      const needsApproval =
        typeof reason === "object" &&
        reason !== null &&
        "reason" in reason &&
        reason.reason === "timer_channel_reapproval_required";
      setStatus({
        state: needsApproval ? "reauthorization_required" : "error",
        optedIn: false,
      });
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function reviewAccess() {
    if (!delivers) return;
    // The collection gate delegates to the one SDK entry and checks its scope.
    reauthorizeCurrentCollection();
  }

  return {
    delivers,
    status,
    busy,
    error,
    label: delivers
      ? changeNotificationLabel(status)
      : translate({ message: "Not available" }),
    setEnabled,
    reviewAccess,
    retry,
  };
}

function ReminderSettings({ reminders }: { reminders: ReminderSettingsState }) {
  const { delivers, status, busy, error } = reminders;
  if (!delivers)
    return (
      <div className="settings-status-row">
        <span>
          <Trans>Task reminders</Trans>
        </span>
        <small>{reminders.label}</small>
        <p className="setting-hint">
          <Trans>
            Reminder details are saved on tasks, but this version of TaskNotes
            does not send reminder notifications.
          </Trans>
        </p>
      </div>
    );
  const switchable =
    status.state === "off" ||
    status.state === "enabled" ||
    (status.state === "denied" && status.optedIn);
  const description = translate({
    message:
      "mdbase delivers reminders while TaskNotes is closed. Notifications never include task content.",
  });
  return (
    <>
      {switchable ? (
        <SettingsSwitch
          busy={busy}
          checked={status.optedIn}
          description={
            status.state === "denied"
              ? translate({
                  message:
                    "Notifications are turned off for TaskNotes in system settings. Turn them on there to receive reminders.",
                })
              : description
          }
          label={translate({ message: "Task reminders" })}
          onChange={(enabled) => void reminders.setEnabled(enabled)}
        />
      ) : (
        <div className="settings-status-row">
          <span>
            <Trans>Task reminders</Trans>
          </span>
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
            <Trans>Review notification access</Trans>
          </button>
        </div>
      ) : null}
      {status.state === "error" ? (
        <div className="settings-actions">
          <button
            className="secondary-action"
            disabled={busy}
            type="button"
            onClick={reminders.retry}
          >
            <Trans>Retry notification check</Trans>
          </button>
          <button
            className="secondary-action"
            disabled={busy}
            type="button"
            onClick={() => void reminders.setEnabled(false)}
          >
            Turn reminders off
          </button>
        </div>
      ) : null}
      {error ? (
        <OperationErrorNotice
          action={translate({ message: "Reminder setup" })}
          message={error}
          recovery={translate({
            message: "Check that the collection is connected, then try again.",
          })}
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
        <Trans>
          These choices apply as soon as you make them and don’t change the
          collection.
        </Trans>
      </p>
      <LanguageSettings />
      <div className="settings-group">
        <h3>
          <Trans>Appearance</Trans>
        </h3>
        <div className="setting-row">
          <span>
            <Trans>Color theme</Trans>
          </span>
          <ThemeSelect />
        </div>
      </div>
      <div className="settings-group">
        <h3>
          <Trans>Scratchpad</Trans>
        </h3>
        <div className="setting-row">
          <span>
            <Trans>Default mode for new notes</Trans>
          </span>
          <ScratchpadModePreference />
        </div>
      </div>
      <div className="settings-group">
        <h3>
          <Trans>Calendar</Trans>
        </h3>
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
          : translate({
              message: "TaskNotes could not open the install prompt.",
            }),
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
          ? translate({ message: "Opening install prompt…" })
          : install.instructionsOnly
            ? install.showInstructions
              ? translate({ message: "Hide installation steps" })
              : translate({ message: "How to install" })
            : translate({ message: "Install app" })}
      </button>
    </>
  );
}

function InstallFeedback({ install }: { install: InstallPrompt }) {
  return (
    <>
      {install.showInstructions ? (
        <p className="section-copy" role="status">
          <Trans>
            Open your browser’s Share menu, then choose Add to Home Screen.
          </Trans>
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
    <aside
      aria-label={translate({ message: "Install TaskNotes" })}
      className="settings-banner"
    >
      <p>
        <Trans>Install TaskNotes to open it from your home screen.</Trans>
      </p>
      <div className="settings-actions">
        <InstallAction install={install} />
        <button className="text-action" type="button" onClick={install.dismiss}>
          <Trans>Not now</Trans>
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
        <small>
          <Trans>Version </Trans>
          {__APP_VERSION__}
        </small>
      </div>
      {install.available ? (
        <>
          <div className="setting-row">
            <span>
              <Trans>Install on this device</Trans>
            </span>
            <InstallAction install={install} />
          </div>
          {install.dismissed ? <InstallFeedback install={install} /> : null}
        </>
      ) : null}
      <div className="settings-group">
        <h3>
          <Trans>Help</Trans>
        </h3>
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
              Yes. Use Change collection under Collection to open another mdbase
              collection. Changing collections does not move records between
              them.
            </Trans>
          </p>
        </details>
      </div>
    </>
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

function connectionLabel(
  connection: ReturnType<typeof useRepository>["connection"],
  notice: ConnectionNotice | null,
): string {
  if (connection.state === "connecting")
    return translate({ message: "Connecting" });
  if (notice) return connectionNoticeLabels[notice];
  if (connection.state === "unavailable")
    return translate({ message: "Collection unavailable" });
  if (connection.savedOnDevice)
    return translate({ message: "Saved on this device; waiting for sync" });
  return translate({ message: "Connected" });
}
