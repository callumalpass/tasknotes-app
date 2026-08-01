import { fireEvent, render, screen } from "@testing-library/react";

import { TimeTrackingField } from "./task-time-tracking";

const handlers = () => ({
  onStart: vi.fn(),
  onStop: vi.fn(),
  onReplace: vi.fn(),
  onRemove: vi.fn(),
});

it("starts a described work session and clears the capture field", () => {
  const actions = handlers();
  render(
    <TimeTrackingField {...actions} busy={false} entries={[]} error={null} />,
  );

  const description = screen.getByLabelText("Timer description");
  fireEvent.change(description, { target: { value: "  Review launch  " } });
  fireEvent.click(screen.getByRole("button", { name: "Start" }));

  expect(actions.onStart).toHaveBeenCalledWith("Review launch");
  expect(description).toHaveValue("");
});

it("edits and removes an existing session while presenting clean errors", () => {
  const actions = handlers();
  render(
    <TimeTrackingField
      {...actions}
      busy={false}
      entries={[
        {
          startTime: "2026-07-31T01:00:00.000Z",
          endTime: "2026-07-31T01:30:00.000Z",
          description: "Draft",
        },
      ]}
      error="time_tracking: Storage unavailable"
    />,
  );

  expect(screen.getByRole("alert")).toHaveTextContent("Storage unavailable");
  fireEvent.click(screen.getByRole("button", { name: "1 session" }));
  fireEvent.click(screen.getByText("Draft").closest("button")!);
  fireEvent.change(screen.getByLabelText("Session description"), {
    target: { value: "Final review" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save session" }));

  expect(actions.onReplace).toHaveBeenCalledWith([
    expect.objectContaining({ description: "Final review" }),
  ]);
  fireEvent.click(screen.getByRole("button", { name: "Remove Draft" }));
  expect(actions.onRemove).toHaveBeenCalledWith(0);
});
