import { cleanup, render, screen } from "../test/render";
import { afterEach, expect, it } from "vitest";
import { ViewEmptyState } from "./view-empty-state";
afterEach(cleanup);
it("makes a stale empty result distinct from completing the day", () => {
  render(<ViewEmptyState view={{ id: "today" }} stale />);
  expect(screen.getByRole("heading")).toHaveTextContent("No cached tasks");
  expect(
    screen.getByText("Retry this view to check for tasks."),
  ).toBeInTheDocument();
  expect(screen.queryByText(/done for today/)).not.toBeInTheDocument();
});
