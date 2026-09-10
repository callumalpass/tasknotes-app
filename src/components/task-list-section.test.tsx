import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TaskListSection } from "./task-list-section";

beforeEach(() => localStorage.clear());
afterEach(cleanup);
const props = {
  preferenceKey: "collection:view:overdue",
  label: "Overdue",
  count: 9,
  laneKey: "overdue",
};
describe("collapsible task sections", () => {
  it("starts expanded and remembers an explicit choice", () => {
    const { unmount } = render(
      <TaskListSection {...props}>Tasks</TaskListSection>,
    );
    const toggle = screen.getByRole("button", { name: "Overdue 9" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(screen.queryByText("Tasks")).not.toBeInTheDocument();
    unmount();
    render(<TaskListSection {...props}>Tasks</TaskListSection>);
    expect(screen.getByRole("button")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
  it("temporarily expands during arrangement without overwriting the choice", () => {
    localStorage.setItem(props.preferenceKey, "collapsed");
    const { rerender } = render(
      <TaskListSection {...props} arranging>
        Tasks
      </TaskListSection>,
    );
    expect(screen.getByText("Tasks")).toBeVisible();
    expect(screen.getByRole("button")).toBeDisabled();
    rerender(<TaskListSection {...props}>Tasks</TaskListSection>);
    expect(screen.queryByText("Tasks")).not.toBeInTheDocument();
  });
  it("does not leak preferences to another view or collection", () => {
    localStorage.setItem(props.preferenceKey, "collapsed");
    render(
      <TaskListSection {...props} preferenceKey="another:view:overdue">
        Tasks
      </TaskListSection>,
    );
    expect(screen.getByText("Tasks")).toBeVisible();
  });
  it("only shows empty drop destinations while arranging", () => {
    const { rerender } = render(
      <TaskListSection {...props} count={0}>
        Drop here
      </TaskListSection>,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    rerender(
      <TaskListSection {...props} count={0} arranging>
        Drop here
      </TaskListSection>,
    );
    expect(screen.getByText("Drop here")).toBeVisible();
  });
});
