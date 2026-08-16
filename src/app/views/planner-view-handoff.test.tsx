import { render, screen } from "@testing-library/react";

import { PlannerViewHandoff } from "./planner-view-handoff";

it("offers the executed Planner view as an external handoff", () => {
  render(
    <PlannerViewHandoff
      href="https://planner.tasknotes.dev/?view=launch"
      taskCount={7}
    />,
  );
  expect(screen.getByText("7 tasks are ready in this view.")).toBeVisible();
  expect(screen.getByRole("link", { name: /Open in Planner/ })).toHaveAttribute(
    "href",
    "https://planner.tasknotes.dev/?view=launch",
  );
});
