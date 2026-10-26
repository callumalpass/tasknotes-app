import { Capacitor } from "@capacitor/core";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "../test/render";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TimersApi } from "@mdbase-dev/sdk";
import type {
  MdbaseNotificationManagerOptions,
  MdbaseNotificationStatus,
} from "../native/mdbase-notifications";
import { deferred } from "../test/mdbase-fixture";
import { defaultCalendarPreferences } from "./calendar-preferences";
import type { SettingsSection } from "./settings-sections";

const fixture = vi.hoisted(() => ({
  narrow: false,
  status: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn(),
  subscribeStatus: vi.fn(),
  statusListeners: new Set<() => void>(),
  reauthorize: vi.fn(),
  reminderAuthority: "connect",
  connection: { state: "connected" } as { state: string; message?: string },
  repository: {},
  retrySummary: vi.fn(),
  summaryError: null as Error | null,
  resume: null as ((event: { isActive: boolean }) => void) | null,
  remove: vi.fn(async () => undefined),
}));
vi.mock("../native/mdbase-notifications", () => ({
  mdbaseNotifications: {
    status: fixture.status,
    enable: fixture.enable,
    disable: fixture.disable,
    subscribeStatus: fixture.subscribeStatus,
  },
}));
vi.mock("../cloud/connect", () => {
  throw new Error("Settings must not construct a legacy Connect owner");
});
vi.mock("./use-narrow-layout", () => ({
  useNarrowLayout: () => fixture.narrow,
}));
vi.mock("@capacitor/app", () => ({
  App: {
    addListener: vi.fn((_event, listener) => {
      fixture.resume = listener;
      return Promise.resolve({ remove: fixture.remove });
    }),
  },
}));
vi.mock("./repository-context", () => ({
  useCollectionSummary: () => ({
    info: { name: "My tasks", location: "Live connection through mdbase" },
    stats: fixture.summaryError ? null : { open: 3, total: 5 },
    loading: false,
    error: fixture.summaryError,
    retry: fixture.retrySummary,
  }),
  useRepository: () => ({
    connection: fixture.connection,
    repository: fixture.repository,
    lastRefresh: null,
    refresh: vi.fn(async () => undefined),
    refreshing: false,
    reminderAuthority: fixture.reminderAuthority,
  }),
}));
vi.mock("./collection-context", () => ({
  useCollectionGate: () => ({
    collectionUi: null,
    changeCollection: vi.fn(),
    reauthorizeCurrentCollection: fixture.reauthorize,
  }),
}));
vi.mock("../pwa/install", () => ({
  usePwaInstall: () => "available",
  requestPwaInstall: vi.fn(),
}));
vi.mock("../components/task-model-settings", () => ({
  TaskModelSettingsEditor: () => <p>Task model editor</p>,
}));
vi.mock("../components/scratchpad-mode-preference", () => ({
  ScratchpadModePreference: () => null,
}));

import { MoreScreen } from "./more-screen";

beforeEach(() => {
  fixture.narrow = false;
  fixture.reminderAuthority = "connect";
  fixture.reauthorize.mockReset();
  fixture.connection = { state: "connected" };
  fixture.status
    .mockReset()
    .mockResolvedValue({ state: "off", optedIn: false });
  fixture.enable
    .mockReset()
    .mockResolvedValue({ state: "enabled", optedIn: true });
  fixture.disable
    .mockReset()
    .mockResolvedValue({ state: "off", optedIn: false });
  fixture.statusListeners.clear();
  fixture.subscribeStatus
    .mockReset()
    .mockImplementation((listener: () => void) => {
      fixture.statusListeners.add(listener);
      return () => fixture.statusListeners.delete(listener);
    });
  fixture.retrySummary.mockReset();
  fixture.summaryError = null;
  fixture.resume = null;
  fixture.remove.mockClear();
  window.localStorage.clear();
  // jsdom has no layout, so it does not implement scrollIntoView.
  Element.prototype.scrollIntoView = () => undefined;
});
afterEach(() => {
  vi.restoreAllMocks();
  delete (Element.prototype as Partial<Element>).scrollIntoView;
});

function settings(
  section?: SettingsSection,
  onSection = vi.fn<(section?: SettingsSection, replace?: boolean) => void>(),
) {
  return (
    <MoreScreen
      calendarPreferences={defaultCalendarPreferences()}
      section={section}
      onCalendarPreferencesChange={vi.fn()}
      onSection={onSection}
    />
  );
}

it("groups desktop settings by scope behind a section index", () => {
  const onSection = vi.fn();
  render(settings(undefined, onSection));
  const index = screen.getByRole("navigation", { name: "Settings sections" });
  expect(
    within(index)
      .getAllByRole("link")
      .map((link) => link.textContent),
  ).toEqual([
    "Collection",
    "Reminders",
    "On this device",
    "Collection behavior",
    "About & help",
  ]);
  expect(screen.getByText("This device only")).toBeVisible();
  expect(
    screen.getByText("Shared with everyone using this collection"),
  ).toBeVisible();
  // Storage is explained once, in the Collection disclosure.
  expect(screen.queryByText("Where are my tasks saved?")).toBeNull();
  fireEvent.click(within(index).getByRole("link", { name: "Reminders" }));
  expect(onSection).toHaveBeenCalledWith("reminders", true);
});

it("merges collection identity and connection into one card", () => {
  render(settings());
  const collection = screen.getByRole("region", { name: "Collection" });
  expect(within(collection).getByText("My tasks")).toBeVisible();
  expect(within(collection).getByText("Connected")).toBeVisible();
  expect(within(collection).getByText("· 3 open · 5 total")).toBeVisible();
  expect(
    within(collection).getByRole("button", { name: "Refresh now" }),
  ).toBeVisible();
  expect(
    within(collection).getByRole("button", { name: "Change collection" }),
  ).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Connection" })).toBeNull();
});

it("turns reminders on and off with one switch", async () => {
  render(settings());
  const reminders = await screen.findByRole("switch", {
    name: "Task reminders",
  });
  expect(reminders).not.toBeChecked();
  fireEvent.click(reminders);
  await vi.waitFor(() => expect(fixture.enable).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(reminders).toBeChecked());
  fireEvent.click(reminders);
  await vi.waitFor(() => expect(fixture.disable).toHaveBeenCalledOnce());
});

it("delegates notification access review to the original SDK collection gate", async () => {
  fixture.status.mockResolvedValue({
    state: "reauthorization_required",
    optedIn: false,
  });
  render(settings());
  fireEvent.click(
    await screen.findByRole("button", { name: "Review notification access" }),
  );
  expect(fixture.reauthorize).toHaveBeenCalledOnce();
  expect(fixture.enable).not.toHaveBeenCalled();
});

it("does not load or authorize reminders without delivery authority", () => {
  fixture.reminderAuthority = "none";
  render(settings());
  expect(
    screen.queryByRole("button", { name: "Review notification access" }),
  ).not.toBeInTheDocument();
  expect(fixture.status).not.toHaveBeenCalled();
  expect(fixture.reauthorize).not.toHaveBeenCalled();
});

it("explains reminder failures before their technical detail", async () => {
  fixture.status.mockRejectedValueOnce(new Error("socket hang up"));
  render(settings());
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Reminder setup could not finish.");
  expect(alert).not.toHaveTextContent("socket hang up");
  expect(screen.getByText("socket hang up")).toBeInTheDocument();
});

it("lists categories on phones and opens each as its own page", async () => {
  fixture.narrow = true;
  const onSection = vi.fn();
  const view = render(settings(undefined, onSection));
  expect(screen.queryByText("Task model editor")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Collection behavior/ }));
  expect(onSection).toHaveBeenCalledWith("behavior");

  view.rerender(settings("behavior", onSection));
  expect(
    screen.getByRole("heading", { level: 1, name: "Collection behavior" }),
  ).toBeVisible();
  expect(screen.getByText("Task model editor")).toBeVisible();
  expect(screen.queryByRole("region", { name: "Reminders" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Back to Settings" }));
  expect(onSection).toHaveBeenLastCalledWith(undefined, true);
});

it("offers installation once at the top and remembers dismissal", () => {
  render(settings());
  const banner = screen.getByRole("complementary", {
    name: "Install TaskNotes",
  });
  fireEvent.click(within(banner).getByRole("button", { name: "Not now" }));
  expect(
    screen.queryByRole("complementary", { name: "Install TaskNotes" }),
  ).toBeNull();
  // Still reachable from About.
  expect(
    within(screen.getByRole("region", { name: "About & help" })).getByRole(
      "button",
      { name: /Install app/ },
    ),
  ).toBeVisible();
});

it("remembers whether storage details are open", () => {
  const first = render(settings());
  fireEvent.click(screen.getByRole("button", { name: "How tasks are stored" }));
  expect(screen.getByText("Live connection through mdbase")).toBeVisible();
  first.unmount();
  render(settings());
  expect(
    screen.getByRole("button", { name: "How tasks are stored" }),
  ).toHaveAttribute("aria-expanded", "true");
});

it("offers retry after a failed permission check and only enables on explicit opt-in", async () => {
  fixture.status.mockRejectedValueOnce(
    new Error("Checking notification permission timed out. Try again."),
  );
  render(settings());
  expect(await screen.findByText("Setup needs attention")).toBeVisible();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Reminder setup could not finish.",
  );
  expect(screen.getByText(/timed out/)).toBeInTheDocument();
  expect(fixture.enable).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Retry notification check" }),
  );
  const toggle = await screen.findByRole("switch", {
    name: "Task reminders",
  });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  fireEvent.click(toggle);
  await vi.waitFor(() => expect(fixture.enable).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(toggle).toBeChecked());
});

it("shows the collection name and actionable errors instead of zero counts", async () => {
  fixture.summaryError = new Error("Statistics unavailable");
  render(settings());
  const collection = screen.getByRole("region", { name: "Collection" });
  expect(within(collection).getByText("My tasks")).toBeVisible();
  expect(within(collection).getByText(/Details need attention/)).toBeVisible();
  expect(within(collection).getByRole("alert")).toHaveTextContent(
    "Statistics unavailable",
  );
  expect(
    within(collection).queryByText(/0 open · 0 total/),
  ).not.toBeInTheDocument();
  fireEvent.click(
    within(collection).getByRole("button", {
      name: "Retry collection details",
    }),
  );
  expect(fixture.retrySummary).toHaveBeenCalledOnce();
  await screen.findByRole("switch", { name: "Task reminders" });
});

it("rechecks native permissions on resume and removes its listener", async () => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  const view = render(settings());
  await screen.findByRole("switch", { name: "Task reminders" });
  fixture.status.mockResolvedValueOnce({ state: "denied", optedIn: false });
  act(() => fixture.resume!({ isActive: true }));
  expect(await screen.findByText("Disabled in system settings")).toBeVisible();
  view.unmount();
  await waitFor(() => expect(fixture.remove).toHaveBeenCalledOnce());
});

it("ignores an old passive check after explicit enablement", async () => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  render(settings());
  const toggle = await screen.findByRole("switch", {
    name: "Task reminders",
  });
  const pending = deferred<MdbaseNotificationStatus>();
  fixture.status.mockReturnValueOnce(pending.promise);
  act(() => fixture.resume!({ isActive: true }));
  // Let the passive recheck start (and stay pending) before toggling.
  await vi.waitFor(() => expect(fixture.status).toHaveBeenCalledTimes(2));
  fireEvent.click(toggle);
  await vi.waitFor(() => expect(fixture.enable).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(toggle).toBeChecked());
  await act(async () => pending.resolve({ state: "off", optedIn: false }));
  expect(screen.getByRole("switch", { name: "Task reminders" })).toBeChecked();
});

async function restoringReminders() {
  const { MdbaseNotificationManager } = await vi.importActual<
    typeof import("../native/mdbase-notifications")
  >("../native/mdbase-notifications");
  const acknowledgement = deferred<void>();
  const registerWebPush = vi.fn().mockReturnValueOnce(acknowledgement.promise);
  const unregisterWebPush = vi.fn(async () => undefined);
  const requestPermissions = vi.fn();
  const subject = new MdbaseNotificationManager({
    storage: localStorage,
    isNative: () => false,
    isConfigured: () => true,
    webPush: {
      isSupported: () => true,
      checkPermissions: async () => ({ receive: "granted" }),
      requestPermissions,
      serviceWorker: async () => ({}) as ServiceWorkerRegistration,
      addListener: async () => ({ remove: async () => undefined }),
    },
  } as unknown as MdbaseNotificationManagerOptions);
  const consentKey = "tasknotes:mdbase-notifications:v2:original-grant";
  localStorage.setItem(consentKey, "1");
  const unbind = subject.bindScope({
    key: "original-grant",
    timers: { registerWebPush, unregisterWebPush } as unknown as TimersApi,
  });
  fixture.status.mockImplementation(() => subject.status());
  fixture.enable.mockImplementation(() => subject.enable());
  fixture.disable.mockImplementation(() => subject.disable());
  fixture.subscribeStatus.mockImplementation((listener: () => void) =>
    subject.subscribeStatus(listener),
  );
  // Same automatic restoration as AppShell: no Settings interaction.
  const dispose = subject.listen(vi.fn());
  await waitFor(() => expect(registerWebPush).toHaveBeenCalledOnce());
  return {
    subject,
    acknowledgement,
    registerWebPush,
    requestPermissions,
    consentKey,
    dispose: () => {
      dispose();
      unbind();
    },
  };
}

it("updates pending restoration to On on completion without Retry or new consent", async () => {
  const f = await restoringReminders();
  const view = render(settings());
  expect(await screen.findByText("Setup needs attention")).toBeVisible();
  expect(localStorage.getItem(f.consentKey)).toBe("pending");
  await act(async () => f.acknowledgement.resolve());
  expect(
    await screen.findByRole("switch", { name: "Task reminders" }),
  ).toBeChecked();
  expect(localStorage.getItem(f.consentKey)).toBe("1");
  expect(screen.queryByText("Setup needs attention")).not.toBeInTheDocument();
  expect(fixture.status).toHaveBeenCalledTimes(2);
  expect(fixture.enable).not.toHaveBeenCalled();
  expect(fixture.disable).not.toHaveBeenCalled();
  expect(f.registerWebPush).toHaveBeenCalledOnce();
  expect(f.requestPermissions).not.toHaveBeenCalled();

  // A later automatic refresh refusal must also reach the mounted Settings.
  f.registerWebPush.mockRejectedValueOnce({
    code: "permission_denied",
    reason: "notification_reauthorization_required",
  });
  await act(async () => {
    await expect(f.subject.refreshRegistration()).rejects.toMatchObject({
      reason: "notification_reauthorization_required",
    });
  });
  expect(
    await screen.findByRole("button", { name: "Review notification access" }),
  ).toBeVisible();
  expect(f.registerWebPush).toHaveBeenCalledTimes(2);
  expect(f.requestPermissions).not.toHaveBeenCalled();
  view.unmount();
  f.dispose();
});

it("keeps a genuinely unresolved restoration in error until explicit cleanup", async () => {
  const f = await restoringReminders();
  const view = render(settings());
  expect(await screen.findByText("Setup needs attention")).toBeVisible();
  await act(async () => {
    f.acknowledgement.reject({ code: "outcome_unknown" });
  });
  await waitFor(() => expect(fixture.status).toHaveBeenCalledTimes(2));
  expect(screen.getByText("Setup needs attention")).toBeVisible();
  expect(localStorage.getItem(f.consentKey)).toBe("pending");
  await act(async () => f.subject.refreshRegistration());
  expect(f.registerWebPush).toHaveBeenCalledOnce();
  expect(f.requestPermissions).not.toHaveBeenCalled();
  expect(fixture.enable).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Turn reminders off" }));
  expect(
    await screen.findByRole("switch", { name: "Task reminders" }),
  ).not.toBeChecked();
  expect(localStorage.getItem(f.consentKey)).toBeNull();
  expect(fixture.disable).toHaveBeenCalledOnce();
  view.unmount();
  f.dispose();
});

it("removes the status subscription on unmount, including before module loading finishes", async () => {
  const view = render(settings());
  await screen.findByRole("switch", { name: "Task reminders" });
  await waitFor(() => expect(fixture.statusListeners.size).toBe(1));
  const listener = [...fixture.statusListeners][0];
  view.unmount();
  expect(fixture.statusListeners.size).toBe(0);
  await act(async () => listener());
  expect(fixture.status).toHaveBeenCalledOnce();

  fixture.subscribeStatus.mockClear();
  const immediate = render(settings());
  immediate.unmount();
  await act(async () => undefined);
  expect(fixture.subscribeStatus).not.toHaveBeenCalled();
  expect(fixture.statusListeners.size).toBe(0);
});

it("offers explicit cleanup for unresolved registration without passively replaying it", async () => {
  fixture.status.mockResolvedValue({ state: "error", optedIn: false });
  render(settings());
  fireEvent.click(
    await screen.findByRole("button", { name: "Turn reminders off" }),
  );
  await waitFor(() => expect(fixture.disable).toHaveBeenCalledOnce());
  const toggle = await screen.findByRole("switch", { name: "Task reminders" });
  expect(toggle).not.toBeChecked();
  expect(fixture.enable).not.toHaveBeenCalled();
  fireEvent.click(toggle);
  await waitFor(() => expect(fixture.enable).toHaveBeenCalledOnce());
});

it("offers cleanup immediately when an explicit registration has an unknown outcome", async () => {
  fixture.enable.mockRejectedValueOnce(
    new Error("Registration outcome is unknown"),
  );
  render(settings());
  fireEvent.click(
    await screen.findByRole("switch", { name: "Task reminders" }),
  );
  expect(
    await screen.findByRole("button", { name: "Turn reminders off" }),
  ).toBeVisible();
  expect(fixture.enable).toHaveBeenCalledOnce();
  expect(fixture.disable).not.toHaveBeenCalled();
});

it("offers the original approval flow when the SDK cannot unregister an uncertain registration", async () => {
  fixture.status.mockResolvedValueOnce({ state: "error", optedIn: false });
  fixture.disable.mockRejectedValueOnce(
    Object.assign(new Error("Allow reminders again"), {
      code: "outcome_unknown",
      reason: "timer_channel_reapproval_required",
    }),
  );
  render(settings());
  fireEvent.click(
    await screen.findByRole("button", { name: "Turn reminders off" }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Review notification access" }),
  );
  expect(fixture.reauthorize).toHaveBeenCalledOnce();
  expect(fixture.enable).not.toHaveBeenCalled();
  expect(fixture.disable).toHaveBeenCalledOnce();
});

it("retains an actionable approval result from explicit registration", async () => {
  fixture.enable.mockResolvedValueOnce({
    state: "reauthorization_required",
    optedIn: false,
  });
  render(settings());
  fireEvent.click(
    await screen.findByRole("switch", { name: "Task reminders" }),
  );
  expect(
    await screen.findByRole("button", { name: "Review notification access" }),
  ).toBeVisible();
});
