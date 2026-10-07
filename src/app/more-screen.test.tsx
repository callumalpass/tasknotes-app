import { Capacitor } from "@capacitor/core";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { deferred } from "../test/mdbase-fixture";
import type { MdbaseNotificationStatus } from "../native/mdbase-notifications";
import { defaultCalendarPreferences } from "./calendar-preferences";

const fixture = vi.hoisted(() => ({
  status: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn(),
  retrySummary: vi.fn(),
  refresh: vi.fn(),
  summaryError: null as Error | null,
  session: { status: "ready", revision: 0 },
  resume: null as ((event: { isActive: boolean }) => void) | null,
  remove: vi.fn(async () => undefined),
}));
vi.mock("../native/mdbase-notifications", () => ({
  mdbaseNotifications: fixture,
}));
vi.mock("../cloud/connect", () => ({ cloudSession: { authorize: vi.fn() } }));
vi.mock("../cloud/use-session", () => ({
  useCloudSessionSnapshot: () => fixture.session,
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
    connection: { state: "connected" },
    lastRefresh: null,
    refresh: fixture.refresh,
    refreshing: false,
    reminderAuthority: "connect",
  }),
}));
vi.mock("./collection-context", () => ({
  useCollectionGate: () => ({ changeCollection: vi.fn() }),
}));
vi.mock("../pwa/install", () => ({
  usePwaInstall: () => "unavailable",
  requestPwaInstall: vi.fn(),
}));
vi.mock("../components/task-model-settings", () => ({
  TaskModelSettingsEditor: () => null,
}));
vi.mock("../components/scratchpad-mode-preference", () => ({
  ScratchpadModePreference: () => null,
}));
vi.mock("../components/calendar-preferences", () => ({
  CalendarPreferencesEditor: () => null,
}));

import { MoreScreen } from "./more-screen";

beforeEach(() => {
  vi.clearAllMocks();
  fixture.status
    .mockReset()
    .mockResolvedValue({ state: "off", optedIn: false });
  fixture.enable
    .mockReset()
    .mockResolvedValue({ state: "enabled", optedIn: true });
  fixture.disable
    .mockReset()
    .mockResolvedValue({ state: "off", optedIn: false });
  fixture.refresh.mockReset().mockResolvedValue(undefined);
  fixture.summaryError = null;
  fixture.session = { status: "ready", revision: 0 };
  fixture.resume = null;
});

function settings() {
  return (
    <MoreScreen
      calendarPreferences={defaultCalendarPreferences()}
      onCalendarPreferencesChange={vi.fn()}
    />
  );
}

it("offers retry after a failed permission check and only enables on explicit opt-in", async () => {
  fixture.status.mockRejectedValueOnce(
    new Error("Checking notification permission timed out. Try again."),
  );
  render(settings());
  expect(await screen.findByText("Setup needs attention")).toBeVisible();
  expect(screen.getByRole("alert")).toHaveTextContent("timed out");
  expect(fixture.enable).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Retry notification check" }),
  );
  const enable = await screen.findByRole("button", {
    name: "Turn on reminders",
  });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  fireEvent.click(enable);
  expect(await screen.findByText("On", { exact: true })).toBeVisible();
  expect(fixture.enable).toHaveBeenCalledOnce();
});

it("shows the collection name and actionable errors instead of zero counts", async () => {
  fixture.summaryError = new Error("Statistics unavailable");
  render(settings());
  expect(screen.getByText("My tasks")).toBeVisible();
  expect(screen.getByText("Details need attention")).toBeVisible();
  expect(screen.getByRole("alert")).toHaveTextContent("Statistics unavailable");
  expect(
    screen.queryByText("Opening", { exact: true }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("0 open · 0 total")).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Retry collection details" }),
  );
  expect(fixture.retrySummary).toHaveBeenCalledOnce();
  await screen.findByRole("button", { name: "Turn on reminders" });
});

it("rechecks after authorization changes without remounting Settings", async () => {
  fixture.status.mockResolvedValueOnce({
    state: "reauthorization_required",
    optedIn: false,
  });
  const view = render(settings());
  await screen.findByRole("button", { name: "Review notification access" });
  fixture.session = { status: "ready", revision: 1 };
  view.rerender(settings());
  expect(
    await screen.findByRole("button", { name: "Turn on reminders" }),
  ).toBeVisible();
});

it("rechecks native permissions on resume and removes its listener", async () => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  const view = render(settings());
  await screen.findByRole("button", { name: "Turn on reminders" });
  fixture.status.mockResolvedValueOnce({ state: "denied", optedIn: false });
  act(() => fixture.resume!({ isActive: true }));
  expect(await screen.findByText("Disabled in system settings")).toBeVisible();
  view.unmount();
  await waitFor(() => expect(fixture.remove).toHaveBeenCalledOnce());
});

it("ignores an old passive check after explicit enablement", async () => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  render(settings());
  const enable = await screen.findByRole("button", {
    name: "Turn on reminders",
  });
  const pending = deferred<MdbaseNotificationStatus>();
  fixture.status.mockReturnValueOnce(pending.promise);
  act(() => fixture.resume!({ isActive: true }));
  fireEvent.click(enable);
  await screen.findByText("On", { exact: true });
  await act(async () => pending.resolve({ state: "off", optedIn: false }));
  expect(screen.getByText("On", { exact: true })).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Turn off reminders" }),
  ).toBeVisible();
});

it("retains an actionable approval result from explicit registration", async () => {
  fixture.enable.mockResolvedValueOnce({
    state: "reauthorization_required",
    optedIn: false,
  });
  render(settings());
  fireEvent.click(
    await screen.findByRole("button", { name: "Turn on reminders" }),
  );
  expect(
    await screen.findByRole("button", { name: "Review notification access" }),
  ).toBeVisible();
});
