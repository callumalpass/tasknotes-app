import { fireEvent, render, screen } from "@testing-library/react";
import { toOperationalError } from "../application/operational-error";
import { CUTOVER_MESSAGES, cutoverRefusal } from "../test/cutover-fixtures";
import { OperationErrorNotice } from "./operation-error-notice";
import { ViewExecutionErrorNotice } from "./view-execution-error-notice";
import { normalizeConnectProblem } from "@mdbase-dev/connect-protocol";

it("shows a mid-session cutover message verbatim instead of hiding it", () => {
  render(
    <OperationErrorNotice
      action="Saving the task"
      message={toOperationalError(cutoverRefusal("moved"), "Saving the task")}
      recovery="Try again."
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent(CUTOVER_MESSAGES.moved);
  expect(screen.queryByText("Saving the task could not finish.")).toBeNull();
  expect(screen.queryByText("Technical details")).toBeNull();
  expect(
    screen.getByRole("button", { name: "Update TaskNotes" }),
  ).toBeVisible();
});

it("treats a mid-session upgrade as a temporary state", () => {
  render(
    <OperationErrorNotice
      action="Saving the task"
      message={toOperationalError(
        cutoverRefusal("migrating"),
        "Saving the task",
      )}
      recovery="Try again."
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    CUTOVER_MESSAGES.migrating,
  );
  expect(screen.queryByRole("alert")).toBeNull();
});

it("keeps the existing notice for other server codes", () => {
  const reason = Object.assign(new Error("Something odd."), {
    problem: normalizeConnectProblem("some_new_code", "Something odd."),
  });
  render(
    <OperationErrorNotice
      action="Saving the task"
      message={toOperationalError(reason, "Saving the task")}
      recovery="Try again."
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Saving the task could not finish. Try again.",
  );
  expect(screen.getByText("Technical details")).toBeInTheDocument();
});

it("shows a view's cutover refusal with the existing retry while upgrading", () => {
  const onRetry = vi.fn();
  render(
    <ViewExecutionErrorNotice
      canEdit
      onEdit={vi.fn()}
      onRetry={onRetry}
      reason={cutoverRefusal("migrating")}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    CUTOVER_MESSAGES.migrating,
  );
  fireEvent.click(screen.getByRole("button", { name: "Check now" }));
  expect(onRetry).toHaveBeenCalledOnce();
});

it("replaces a view's retry with an update once the collection has moved", () => {
  render(
    <ViewExecutionErrorNotice
      canEdit
      onEdit={vi.fn()}
      onRetry={vi.fn()}
      reason={cutoverRefusal("onboarding_moved")}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    CUTOVER_MESSAGES.onboarding_moved,
  );
  expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  expect(
    screen.getByRole("button", { name: "Update TaskNotes" }),
  ).toBeVisible();
});
