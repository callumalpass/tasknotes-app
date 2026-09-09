import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CollectionAvailability } from "./collection-availability";
const state = vi.hoisted(() => ({
  connection: { state: "unavailable" },
  refreshing: false,
  refresh: vi.fn(),
}));
vi.mock("../app/repository-context", () => ({ useRepository: () => state }));
afterEach(() => {
  state.connection.state = "unavailable";
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
it("does not label a healthy collection as stale", () => {
  state.connection.state = "connected";
  render(<CollectionAvailability />);
  expect(screen.queryByRole("status")).toBeNull();
});
