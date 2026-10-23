import { Capacitor } from "@capacitor/core";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MdbaseNotificationStatus } from "../native/mdbase-notifications";
import { deferred } from "../test/mdbase-fixture";
import { defaultCalendarPreferences } from "./calendar-preferences";
import type { SettingsSection } from "./settings-sections";

const fixture = vi.hoisted(() => ({
  narrow: false,
  status: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn(),
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
