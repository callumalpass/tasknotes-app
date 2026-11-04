import { cleanup, render, screen } from "../test/render";
import { afterEach, expect, it } from "vitest";
import { ViewEmptyState } from "./view-empty-state";
afterEach(cleanup);
const view = {
  id: "0",
  name: "Today",
  documentId: "record",
  documentName: "today",
  source: {
    path: "TaskNotes/Views/today.base",
    format: "obsidian.base",
    revision: "one",
    writable: true,
  },
} as Parameters<typeof ViewEmptyState>[0]["view"];
it("makes a stale empty result distinct from completing the day", () => {
  render(<ViewEmptyState view={{ ...view, id: "today" }} stale />);
  expect(screen.getByRole("heading")).toHaveTextContent("No cached tasks");
  expect(
    screen.getByText("Retry this view to check for tasks."),
  ).toBeInTheDocument();
  expect(screen.queryByText(/done for today/)).not.toBeInTheDocument();
});
it("recognizes a starter Base by source, since its id is an ordinal", () => {
  render(<ViewEmptyState view={view} />);
  expect(screen.getByRole("heading")).toHaveTextContent(/done for today/);
});
