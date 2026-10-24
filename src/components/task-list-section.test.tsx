import { render, screen, cleanup } from "../test/render";
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
  it("keeps a heading action outside the collapse toggle", () => {
    render(
      <TaskListSection
        {...props}
        action={<button type="button">Move all to today</button>}
      >
        Tasks
      </TaskListSection>,
    );
    const toggle = screen.getByRole("button", { name: "Overdue 9" });
    const action = screen.getByRole("button", { name: "Move all to today" });
    expect(screen.getByRole("heading")).toContainElement(toggle);
    expect(toggle).not.toContainElement(action);
    expect(screen.getByRole("heading")).not.toContainElement(action);
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
