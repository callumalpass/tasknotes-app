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
import {
  mdbaseNotifications,
  type MdbaseNotificationStatus,
} from "../native/mdbase-notifications";
import { notificationPermission } from "../native/notifications";
import { CLOUD_OPERATIONS, cloudConnect } from "../cloud/connect";
import {
  applyThemePreference,
  loadThemePreference,
  saveThemePreference,
  type ThemePreference,
} from "../theme";
import { useCollectionGate } from "./collection-context";
import { useCollectionSummary, useRepository } from "./repository-context";

export function MoreScreen({
  navigationViewCount,
  onOpenViews,
}: {
  navigationViewCount: number;
  onOpenViews(): void;
}) {
  const { info, stats, loading } = useCollectionSummary();
  const {
    lastRefresh,
    refresh,
    refreshing,
    sync,
    syncIssues,
    resolveSyncIssue,
  } = useRepository();
  const { choice, choose, changeConnectedCollection } = useCollectionGate();
  const [showLocation, setShowLocation] = useState(false);
  const [reminderNotifications, setReminderNotifications] =
    useState<string>("Checking");
  const [changeNotifications, setChangeNotifications] =
    useState<MdbaseNotificationStatus>({
      state: "unavailable",
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

  useEffect(() => {
    void notificationPermission().then((permission) =>
      setReminderNotifications(
        permission === "unavailable"
          ? "Available in the mobile app"
          : permission === "granted"
            ? "Allowed"
            : permission === "denied"
              ? "Disabled in system settings"
              : "Asked when you add a reminder",
      ),
    );
  }, []);

  useEffect(() => {
    let active = true;
    void mdbaseNotifications
      .status()
      .then((next) => {
        if (active) setChangeNotifications(next);
      })
      .catch((reason: unknown) => {
        if (active)
          setChangeNotificationsError(
            reason instanceof Error ? reason.message : String(reason),
          );
      });
    return () => {
      active = false;
    };
  }, [choice]);

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
      <SettingsSection label="Storage">
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
          <span>
            {sync.mode === "replicated"
              ? "Tasks are cached here and synchronized through mdbase."
              : sync.mode === "live"
                ? "Tasks are read from this collection through mdbase."
                : "Tasks are Markdown files stored locally."}
          </span>
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
        {lastRefresh ? (
          <p className="refresh-detail">
            {lastRefresh.scanned.toLocaleString()} records checked in{" "}
            {lastRefresh.elapsedMs.toLocaleString()} ms.
          </p>
        ) : null}
      </SettingsSection>

      <SettingsSection label="Views">
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
      </SettingsSection>

      <SettingsSection label="Appearance">
        <div className="setting-row">
          <SunMoon aria-hidden="true" size={20} strokeWidth={1.6} />
          <span>Color theme</span>
          <ThemeSelect />
        </div>
      </SettingsSection>

      {benchmarkTools ? (
        <SettingsSection label="Benchmark">
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

      <SettingsSection label="mdbase">
        <div className="setting-row">
          <Cloud aria-hidden="true" size={20} strokeWidth={1.6} />
          <span>mdbase</span>
          <small>{syncLabel(sync)}</small>
        </div>
        {choice === "local" ? (
          <>
            <p className="section-copy">
              Open a compatible collection from mdbase cloud or another
              computer.
            </p>
            <button
              className="text-action"
              type="button"
              onClick={() => choose("cloud")}
            >
              Connect mdbase
            </button>
          </>
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

      <SettingsSection label="Notifications">
        <div className="setting-row">
          <Bell aria-hidden="true" size={20} strokeWidth={1.6} />
          <span>Task reminders</span>
          <small>{reminderNotifications}</small>
        </div>
        <div className="setting-row">
          <Cloud aria-hidden="true" size={20} strokeWidth={1.6} />
          <span>Changes from mdbase</span>
          <small>{changeNotificationLabel(changeNotifications)}</small>
        </div>
        <p className="section-copy">
          Wake TaskNotes when your connected collection changes. Notification
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
                ? "Turn off change notifications"
                : "Turn on change notifications"}
          </button>
        ) : null}
        {changeNotifications.state === "reauthorization_required" ? (
          <button
            className="text-action"
            type="button"
            onClick={() =>
              void cloudConnect
                .authorize([...CLOUD_OPERATIONS])
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
          <p className="inline-error notification-error" role="alert">
            {changeNotificationsError}
          </p>
        ) : null}
      </SettingsSection>

      <SettingsSection label="Portability">
        <div className="setting-row">
          <FileText aria-hidden="true" size={20} strokeWidth={1.6} />
          <span>Markdown collection</span>
          <small>mdbase v0.3</small>
        </div>
      </SettingsSection>

      <SettingsSection label="About">
        <div className="setting-row">
          <Info aria-hidden="true" size={20} strokeWidth={1.6} />
          <span>TaskNotes</span>
          <small>Web-native preview</small>
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

function changeNotificationLabel(status: MdbaseNotificationStatus): string {
  switch (status.state) {
    case "enabled":
      return "On";
    case "off":
      return "Off";
    case "denied":
      return "Disabled in system settings";
    case "not_connected":
      return "Connect mdbase first";
    case "not_configured":
      return "Firebase setup required";
    case "reauthorization_required":
      return "Approval required";
    case "unavailable":
      return "Available in the mobile app";
  }
}

function SettingsSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="settings-section">
      <h2>{label}</h2>
      <div className="settings-content">{children}</div>
    </section>
  );
}
