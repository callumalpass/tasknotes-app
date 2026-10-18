import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
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
vi.mock("./repository-context", () => ({
  useCollectionSummary: () => ({
    info: { name: "My tasks", location: "Live connection through mdbase" },
    stats: { open: 3, total: 5 },
    loading: false,
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
