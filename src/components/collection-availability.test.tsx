import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { CollectionAvailability } from "./collection-availability";
import type {
  HeldEdit,
  RepositoryConnectionStatus,
} from "../application/ports/task-repository";
const state = vi.hoisted(() => ({
  connection: { state: "unavailable" } as RepositoryConnectionStatus,
  refreshing: false,
  refresh: vi.fn(),
}));
vi.mock("../app/repository-context", () => ({ useRepository: () => state }));
afterEach(() => {
  state.connection = { state: "unavailable" };
  state.refreshing = false;
  vi.useRealTimers();
  vi.clearAllMocks();
});
it("labels cached data and contains rejected retries without losing the recovery action", async () => {
  state.refresh.mockRejectedValue(new Error("offline"));
  const settings = vi.fn();
  render(<CollectionAvailability onSettings={settings} />);
  expect(screen.getByRole("status")).toHaveTextContent(
    "Showing previously loaded tasks",
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry connection" }));
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("Could not reconnect"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Connection settings" }));
  expect(settings).toHaveBeenCalledOnce();
});
it.each(["connecting", "connected"] as const)(
  "keeps brief %s work silent and shows only a quiet indicator after five seconds",
  async (connectionState) => {
    vi.useFakeTimers();
    state.connection.state = connectionState;
    state.refreshing = true;
    const { rerender } = render(<CollectionAvailability />);
    expect(screen.queryByRole("status")).toBeNull();
    await act(() => vi.advanceTimersByTime(4_999));
    expect(screen.queryByRole("status")).toBeNull();
    await act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("status")).toHaveTextContent(
      connectionState === "connecting" ? "Connecting…" : "Refreshing…",
    );
    expect(screen.queryByRole("button")).toBeNull();
    state.connection.state = "connected";
    state.refreshing = false;
    rerender(<CollectionAvailability />);
    expect(screen.queryByRole("status")).toBeNull();
    state.refreshing = true;
    rerender(<CollectionAvailability />);
    expect(screen.queryByRole("status")).toBeNull();
  },
);
it("cancels the indicator for a brief refresh", async () => {
  vi.useFakeTimers();
  state.connection.state = "connected";
  state.refreshing = true;
  const { rerender } = render(<CollectionAvailability />);
  await act(() => vi.advanceTimersByTime(1_000));
  state.refreshing = false;
  rerender(<CollectionAvailability />);
  await act(() => vi.advanceTimersByTime(5_000));
  expect(screen.queryByRole("status")).toBeNull();
});
it("keeps known unavailability visible while retrying", () => {
  state.refreshing = true;
  render(<CollectionAvailability />);
  expect(screen.getByRole("status")).toHaveTextContent(
    "changes can’t be saved",
  );
  expect(screen.getByRole("button", { name: "Reconnecting…" })).toBeDisabled();
});
const protectedEdit: HeldEdit = {
  id: "held",
  path: "notes/task.md",
  title: "mdbase protected your edit",
  cause: "This file was changed on another device.",
  detail: "Your version is kept here.",
  reversibleNote: "You can change your mind later.",
  since: "2026-10-07T00:00:00Z",
  saves: 1,
  actions: [],
};
it("keeps protected edits and their review action visible while offline", () => {
  state.connection.heldEdits = [protectedEdit];
  const review = vi.fn();
  render(<CollectionAvailability onSettings={review} />);
  expect(screen.getByText(/mdbase protected your edit/)).toBeVisible();
  expect(screen.getByText(new RegExp(protectedEdit.cause))).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Retry connection" }),
  ).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "Review protected edits" }),
  );
  expect(review).toHaveBeenCalledOnce();
});
it("shows a protected count before detailed hold metadata arrives", () => {
  state.connection = {
    state: "connected",
    sync: {
      text: "Confirmed through 8, plus 0 pending, plus 2 held",
      pending: 0,
      held: 2,
    },
  };
  render(<CollectionAvailability />);
  expect(screen.getByRole("status")).toHaveTextContent(
    "2 edits are waiting for your choice",
  );
});
it("does not label a healthy collection as stale", () => {
  state.connection.state = "connected";
  render(<CollectionAvailability />);
  expect(screen.queryByRole("status")).toBeNull();
});
