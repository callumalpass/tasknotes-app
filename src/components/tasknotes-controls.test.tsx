import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { expect, it, vi } from "vitest";

import {
  TaskNotesCombobox,
  TaskNotesDatePicker,
  TaskNotesDateTimeField,
  TaskNotesSelect,
  TaskNotesTimePicker,
} from "./tasknotes-controls";
import {
  combineTaskDateTime,
  taskDatePart,
  taskTimePart,
} from "../domain/task";

const choices = [
  { value: "open", label: "Open" },
  { value: "waiting", label: "Waiting" },
  { value: "done", label: "Done" },
];

it("selects an option without a browser select element", () => {
  const change = vi.fn();
  render(
    <TaskNotesSelect
      ariaLabel="Status"
      options={choices}
      value="open"
      onChange={change}
    />,
  );

  const trigger = screen.getByRole("combobox", { name: "Status" });
  expect(trigger).toHaveAttribute("data-value", "open");
  expect(document.querySelector("select")).not.toBeInTheDocument();

  fireEvent.click(trigger);
  const list = screen.getByRole("listbox", { name: "Status" });
  expect(within(list).getByRole("option", { name: "Open" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  fireEvent.click(within(list).getByRole("option", { name: "Waiting" }));

  expect(change).toHaveBeenCalledWith("waiting");
  expect(trigger).toHaveFocus();
});

it("supports keyboard selection and skips disabled options", () => {
  const change = vi.fn();
  render(
    <TaskNotesSelect
      ariaLabel="Priority"
      options={[
        { value: "normal", label: "Normal" },
        { value: "blocked", label: "Blocked", disabled: true },
        { value: "high", label: "High" },
      ]}
      value="normal"
      onChange={change}
    />,
  );

  const trigger = screen.getByRole("combobox", { name: "Priority" });
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  fireEvent.keyDown(trigger, { key: "Enter" });

  expect(change).toHaveBeenCalledWith("high");
});

it("filters native property suggestions while preserving free-form values", () => {
  function Example() {
    const [value, setValue] = useState("");
    return (
      <TaskNotesCombobox
        ariaLabel="Property"
        options={[
          { value: "task.status", label: "Status" },
          { value: "task.priority", label: "Priority" },
        ]}
        value={value}
        onChange={setValue}
      />
    );
  }
  render(<Example />);

  const input = screen.getByRole("combobox", { name: "Property" });
  fireEvent.change(input, { target: { value: "prior" } });
  expect(screen.queryByRole("option", { name: /Status/ })).toBeNull();
  fireEvent.click(screen.getByRole("option", { name: /Priority/ }));
  expect(input).toHaveValue("task.priority");

  fireEvent.change(input, { target: { value: "custom.owner" } });
  expect(input).toHaveValue("custom.owner");
  expect(document.querySelector("datalist")).not.toBeInTheDocument();
});

it("chooses, navigates, and clears dates with the TaskNotes calendar", () => {
  const change = vi.fn();
  const { container } = render(
    <TaskNotesDatePicker
      ariaLabel="Scheduled date"
      value="2026-07-24"
      onChange={change}
    />,
  );

  const trigger = screen.getByRole("button", { name: "Scheduled date" });
  fireEvent.click(trigger);
  expect(
    screen.getByRole("dialog", { name: "Scheduled date calendar" }),
  ).toBeVisible();

  const nextDate = container.querySelector<HTMLButtonElement>(
    '[data-date="2026-07-25"]',
  );
  expect(nextDate).not.toBeNull();
  fireEvent.click(nextDate!);
  expect(change).toHaveBeenLastCalledWith("2026-07-25");

  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("button", { name: "Next month" }));
  expect(screen.getByText("August 2026")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Clear" }));
  expect(change).toHaveBeenLastCalledWith(undefined);
  expect(document.querySelector('input[type="date"]')).not.toBeInTheDocument();
});

it("keeps exact minutes in the TaskNotes time picker", () => {
  const change = vi.fn();
  render(
    <TaskNotesTimePicker
      ariaLabel="Scheduled time"
      value="08:30"
      onChange={change}
    />,
  );

  const trigger = screen.getByRole("button", { name: "Scheduled time" });
  fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "Scheduled time" });
  fireEvent.click(
    within(within(dialog).getByRole("listbox", { name: "Hour" })).getByRole(
      "option",
      { name: "09" },
    ),
  );
  fireEvent.click(
    within(within(dialog).getByRole("listbox", { name: "Minute" })).getByRole(
      "option",
      { name: "07" },
    ),
  );
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));

  expect(change).toHaveBeenLastCalledWith("09:07");
  expect(document.querySelector('input[type="time"]')).not.toBeInTheDocument();
});

it("lets task fields adapt zoned storage values to local date and time", () => {
  const instant = new Date(2026, 6, 25, 9, 7).toISOString();
  render(
    <TaskNotesDateTimeField
      combineValue={combineTaskDateTime}
      label="Scheduled"
      splitValue={(value) => ({
        date: taskDatePart(value) || undefined,
        time: taskTimePart(value) || undefined,
      })}
      value={instant}
      onChange={vi.fn()}
    />,
  );

  expect(
    screen.getByRole("button", { name: "Scheduled date" }),
  ).toHaveAttribute("data-value", taskDatePart(instant));
  expect(
    screen.getByRole("button", { name: "Scheduled time" }),
  ).toHaveAttribute("data-value", "09:07");
});
