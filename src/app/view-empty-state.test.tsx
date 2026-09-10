import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ViewEmptyState } from "./view-empty-state";
afterEach(cleanup);
it("explains retention without promising archived tasks appear in global search", () => {
  render(<ViewEmptyState view={{ id: "archive" }} />);
  expect(screen.getByRole("heading")).toHaveTextContent(
    "No archived tasks here.",
  );
  expect(
    screen.getByText(/Archived tasks are kept, not deleted/),
  ).toBeInTheDocument();
  expect(screen.queryByText(/searchable/)).not.toBeInTheDocument();
});
it("makes a stale empty result distinct from completing the day", () => {
  render(<ViewEmptyState view={{ id: "today" }} stale />);
  expect(screen.getByRole("heading")).toHaveTextContent("No cached tasks");
  expect(
    screen.getByText("Retry this view to check for tasks."),
  ).toBeInTheDocument();
  expect(screen.queryByText(/done for today/)).not.toBeInTheDocument();
});
it("uses the Scheduled and Due vocabulary for Upcoming", () => {
  render(<ViewEmptyState view={{ id: "upcoming" }} />);
  expect(
    screen.getByText("Add a Scheduled or Due date to an active task."),
  ).toBeInTheDocument();
});
