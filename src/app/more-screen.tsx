import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Cloud,
  FileText,
  HardDrive,
  Info,
  Bell,
  Columns3,
  SunMoon,
} from "lucide-react";
import { useEffect, useState } from "react";

import { TaskNotesSelect } from "../components/tasknotes-controls";
import { TaskModelSettingsEditor } from "../components/task-model-settings";
import {
  mdbaseNotifications,
  type MdbaseNotificationStatus,
} from "../native/mdbase-notifications";
import {
  activeCloudConnection,
  authorizationReturnTo,
  CLOUD_OPERATIONS,
} from "../cloud/connect";
import {
  applyThemePreference,
  loadThemePreference,
  saveThemePreference,
  type ThemePreference,
} from "../theme";
import { useCollectionGate } from "./collection-context";
import { changeNotificationLabel } from "./notification-label";
import { useCollectionSummary, useRepository } from "./repository-context";
import { localIndexingLabel } from "./indexing-progress";
import { storageExplanation } from "./storage-trust";

export function MoreScreen({
  navigationViewCount,
  onOpenViews,
}: {
  navigationViewCount: number;
  onOpenViews(): void;
}) {
  const { info, stats, loading } = useCollectionSummary();
  const {
    indexing,
    lastRefresh,
    refresh,
    refreshing,
    sync,
    syncIssues,
    resolveSyncIssue,
  } = useRepository();
  const {
    canChooseLocalFolder,
    choice,
    choose,
    changeConnectedCollection,
    changeLocalCollection,
  } = useCollectionGate();
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
  const [benchmark, setBenchmark] = useState<{
    state: "idle" | "writing" | "removing" | "done" | "error";
    detail: string;
  }>({ state: "idle", detail: "" });
  const benchmarkTools = import.meta.env.VITE_BENCHMARK_TOOLS === "1";
  const mdbaseReminders = choice === "cloud";

  useEffect(() => {
    if (!mdbaseReminders) return;
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
  }, [mdbaseReminders]);

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

  async function generateBenchmark() {
    setBenchmark({ state: "writing", detail: "Starting…" });
    try {
      const { generateBenchmarkVault } = await import("../dev/benchmark");
      const writeMs = await generateBenchmarkVault(10_000, (progress) =>
        setBenchmark({
          state: "writing",
          detail: `${progress.completed.toLocaleString()} / ${progress.total.toLocaleString()} files`,
        }),
      );
      const indexed = await refresh();
      setBenchmark({
        state: "done",
        detail: `Wrote files in ${writeMs.toLocaleString()} ms; indexed ${indexed.scanned.toLocaleString()} in ${indexed.elapsedMs.toLocaleString()} ms.`,
      });
    } catch (reason) {
      setBenchmark({
        state: "error",
        detail: reason instanceof Error ? reason.message : String(reason),
      });
    }
  }

  async function removeBenchmark() {
    setBenchmark({ state: "removing", detail: "Starting…" });
    try {
      const { removeBenchmarkVault } = await import("../dev/benchmark");
      const deleteMs = await removeBenchmarkVault((progress) =>
        setBenchmark({
          state: "removing",
          detail: `${progress.completed.toLocaleString()} / ${progress.total.toLocaleString()} files`,
        }),
      );
      await refresh();
      setBenchmark({
        state: "idle",
        detail: `Removed in ${deleteMs.toLocaleString()} ms.`,
      });
    } catch (reason) {
      setBenchmark({
        state: "error",
        detail: reason instanceof Error ? reason.message : String(reason),
      });
    }
  }

  return (
    <section className="screen settings-screen" aria-labelledby="more-title">
      <header className="screen-header compact-header">
        <h1 id="more-title">More</h1>
      </header>
      <SettingsSection label="Collection">
        <div className="setting-row">
          {info?.kind === "connect" ? (
            <Cloud aria-hidden="true" size={20} strokeWidth={1.6} />
          ) : (
            <HardDrive aria-hidden="true" size={20} strokeWidth={1.6} />
          )}
          <span>{info?.name ?? "On this device"}</span>
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
          <span>{storageExplanation(sync.mode)}</span>
          {showLocation ? (
            <ChevronUp aria-hidden="true" size={17} />
          ) : (
            <ChevronDown aria-hidden="true" size={17} />
          )}
        </button>
        {showLocation && info ? (
          <code className="collection-path">{info.location}</code>
        ) : null}
        {choice === "local" && sync.pending ? (
          <p className="refresh-detail" role="status">
            {sync.pending} local{" "}
            {sync.pending === 1 ? "change is" : "changes are"} waiting to be
            written to Markdown. TaskNotes will retry automatically.
          </p>
        ) : null}
        <button
          className="text-action"
          disabled={refreshing}
          type="button"
          onClick={() => void refresh()}
        >
          {refreshing
            ? sync.mode === "replicated"
              ? "Syncing"
              : sync.mode === "live"
                ? "Refreshing"
                : "Checking files"
            : sync.mode === "replicated"
              ? "Sync now"
              : sync.mode === "live"
                ? "Refresh now"
                : "Check files now"}
        </button>
        {choice === "local" && indexing.phase !== "idle" ? (
          <p className="refresh-detail" role="status">
            {localIndexingLabel(indexing)}
          </p>
        ) : null}
        {lastRefresh ? (
          <p className="refresh-detail">
            {lastRefresh.scanned.toLocaleString()} records checked in{" "}
            {lastRefresh.elapsedMs.toLocaleString()} ms.
          </p>
        ) : null}
        {choice === "local" && canChooseLocalFolder ? (
          <button
            className="text-action"
            type="button"
            onClick={changeLocalCollection}
          >
            Choose another folder
          </button>
        ) : null}

        <div className="settings-subsection">
          <h3>Connection</h3>
          <div className="setting-row">
            <Cloud aria-hidden="true" size={20} strokeWidth={1.6} />
            <span>mdbase</span>
            <small>{syncLabel(sync)}</small>
          </div>
          {choice === "local" ? (
            <p className="section-copy">
              Connecting to mdbase does not move this collection&apos;s tasks
              yet, so switching is unavailable here.
            </p>
          ) : (
            <>
              {sync.message ? (
                <p className="section-copy" role="status">
                  {sync.message}
                </p>
              ) : null}
              {sync.pending ? (
                <p className="refresh-detail">
                  {sync.pending} {sync.pending === 1 ? "change" : "changes"}{" "}
                  waiting to upload.
                </p>
              ) : null}
              <div className="cloud-actions">
                <button
                  className="text-action"
                  type="button"
                  onClick={() => choose("local")}
                >
                  Use tasks on this device
                </button>
                <button
                  className="text-action"
                  type="button"
                  onClick={changeConnectedCollection}
                >
                  Change collection
                </button>
              </div>
            </>
          )}
        </div>

        <div className="settings-subsection">
          <h3>Notifications</h3>
          <div className="setting-row">
            <Bell aria-hidden="true" size={20} strokeWidth={1.6} />
            <span>Task reminders</span>
            <small>
              {mdbaseReminders
                ? changeNotificationLabel(changeNotifications)
                : "mdbase collections only"}
            </small>
          </div>
          <p className="section-copy">
            {mdbaseReminders
              ? "mdbase keeps connected reminders running when this app is closed. Notification text never includes task content."
              : "Task reminder delivery requires an mdbase collection."}
          </p>
          {mdbaseReminders &&
          (changeNotifications.state === "off" ||
            changeNotifications.state === "enabled" ||
            (changeNotifications.state === "denied" &&
              changeNotifications.optedIn)) ? (
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
          {mdbaseReminders &&
          changeNotifications.state === "reauthorization_required" ? (
            <button
              className="text-action"
              type="button"
              onClick={() =>
                void activeCloudConnection()
                  ?.authorize({
                    operations: [...CLOUD_OPERATIONS],
                    returnTo: authorizationReturnTo(),
                  })
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
          {choice === "cloud" && changeNotificationsError ? (
            <p className="inline-error notification-error" role="alert">
              {changeNotificationsError}
            </p>
          ) : null}
        </div>
      </SettingsSection>

      {syncIssues.length ? (
        <SettingsSection label="Sync issues">
          <p className="section-copy">
            Choose which version to keep. Other tasks can continue syncing.
          </p>
          <div className="sync-issue-list">
            {syncIssues.map((issue) => (
              <div className="sync-issue" key={issue.id}>
                <div>
                  <strong>{issue.title}</strong>
                  <small>{issue.message}</small>
                </div>
                <div>
                  {issue.canKeepLocal ? (
                    <button
                      className="text-action"
                      type="button"
                      onClick={() => void resolveSyncIssue(issue.id, "local")}
                    >
                      Keep this device
                    </button>
                  ) : null}
                  <button
                    className="text-action"
                    type="button"
                    onClick={() => void resolveSyncIssue(issue.id, "remote")}
                  >
                    Use cloud version
                  </button>
                </div>
              </div>
            ))}
          </div>
        </SettingsSection>
      ) : null}

      <SettingsSection label="Preferences">
        <button
          className="setting-row setting-link"
          type="button"
          onClick={onOpenViews}
        >
          <Columns3 aria-hidden="true" size={20} strokeWidth={1.6} />
          <span>Saved views</span>
          <small>
            {navigationViewCount
              ? `${navigationViewCount} ${navigationViewCount === 1 ? "view" : "views"} in navigation`
              : "Lists, boards, and calendars"}
          </small>
          <ChevronRight aria-hidden="true" size={17} />
        </button>
        <div className="setting-row">
          <SunMoon aria-hidden="true" size={20} strokeWidth={1.6} />
          <span>Color theme</span>
          <ThemeSelect />
        </div>
      </SettingsSection>

      <SettingsSection collapsible label="Advanced">
        <TaskModelSettingsEditor />
        <div className="settings-subsection">
          <h3>Portability</h3>
          <div className="setting-row">
            <FileText aria-hidden="true" size={20} strokeWidth={1.6} />
            <span>Markdown collection</span>
            <small>mdbase v0.3</small>
          </div>
          <p className="section-copy">
            Tasks are ordinary Markdown records. Field mappings and TaskNotes
            settings travel in the collection type contract.
          </p>
        </div>
      </SettingsSection>

      {benchmarkTools ? (
        <SettingsSection collapsible label="Developer benchmark">
          <p className="section-copy">
            Debug build only. Creates disposable local Markdown records.
          </p>
          <div className="benchmark-actions">
            <button
              className="text-action"
              disabled={
                benchmark.state === "writing" || benchmark.state === "removing"
              }
              type="button"
              onClick={() => void generateBenchmark()}
            >
              Generate 10,000 records
            </button>
            <button
              className="text-action danger"
              disabled={
                benchmark.state === "writing" || benchmark.state === "removing"
              }
              type="button"
              onClick={() => void removeBenchmark()}
            >
              Remove benchmark
            </button>
          </div>
          {benchmark.detail ? (
            <p className="refresh-detail" role="status">
              {benchmark.detail}
            </p>
          ) : null}
        </SettingsSection>
      ) : null}

      <SettingsSection label="About">
        <div className="setting-row">
          <Info aria-hidden="true" size={20} strokeWidth={1.6} />
          <span>TaskNotes</span>
          <small>Version 0.1.0</small>
        </div>
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

function syncLabel(sync: ReturnType<typeof useRepository>["sync"]): string {
  if (sync.mode === "local") return "Not connected";
  if (sync.state === "syncing")
    return sync.mode === "live" ? "Refreshing" : "Syncing";
  if (sync.state === "offline")
    return sync.mode === "live"
      ? "Collection unavailable"
      : "Offline · changes saved here";
  if (sync.state === "issues")
    return `${sync.issues} sync ${sync.issues === 1 ? "issue" : "issues"}`;
  if (sync.pending) return `${sync.pending} waiting`;
  return sync.mode === "live" ? "Connected" : "Up to date";
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
