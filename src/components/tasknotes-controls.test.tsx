import { fireEvent, render, screen, within } from "../test/render";
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
import {
  defaultCalendarPreferences,
  saveCalendarPreferences,
} from "../app/calendar-preferences";

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

it("filters long shared capture-chip choices without changing short picker behaviour", () => {
  const change = vi.fn();
  render(
    <TaskNotesSelect
      ariaLabel="Capture priority"
      options={Array.from({ length: 12 }, (_, index) => ({
        value: `custom-${index}`,
        label: `Custom priority ${index}`,
      }))}
      value="custom-0"
      onChange={change}
    />,
  );
  fireEvent.click(screen.getByRole("combobox", { name: "Capture priority" }));
  const filter = screen.getByRole("combobox", {
    name: "Filter Capture priority",
  });
  fireEvent.change(filter, { target: { value: "priority 11" } });
  expect(screen.getAllByRole("option")).toHaveLength(1);
  fireEvent.keyDown(filter, { key: "Enter" });
  expect(change).toHaveBeenCalledWith("custom-11");
});

it("offers view actions in the existing switcher and returns focus before opening an editor", () => {
  const edit = vi.fn();
  render(
    <TaskNotesSelect
      ariaLabel="Saved view"
      value="today"
      options={[{ value: "today", label: "Today" }]}
      onChange={vi.fn()}
      actions={[{ label: "Layout", onChoose: edit }]}
    />,
  );
  const trigger = screen.getByRole("combobox", { name: "Saved view" });
  fireEvent.click(trigger);
  expect(screen.getByRole("option", { name: "Today" })).toHaveFocus();
  expect(screen.getByRole("group", { name: "View actions" })).toContainElement(
    screen.getByRole("button", { name: "Layout" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Layout" }));
  expect(edit).toHaveBeenCalledOnce();
  expect(trigger).toHaveFocus();
  expect(trigger).toHaveAttribute("aria-expanded", "false");
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
      { name: "9 AM" },
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

it.each(["12", "24"] as const)(
  "uses the %s-hour setting in the time heading and wheel",
  (hourFormat) => {
    const change = vi.fn();
    saveCalendarPreferences({ ...defaultCalendarPreferences(), hourFormat });
    try {
      render(
        <TaskNotesTimePicker
          ariaLabel="Scheduled time"
          value="14:29"
          onChange={change}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Scheduled time" }));
      const dialog = screen.getByRole("dialog", { name: "Scheduled time" });
      expect(
        within(dialog).getByText(hourFormat === "12" ? "2:29 PM" : "14:29"),
      ).toBeInTheDocument();
      const hours = within(dialog).getByRole("listbox", { name: "Hour" });
      const selected = within(hours).getByRole("option", { selected: true });
      expect(selected).toHaveTextContent(hourFormat === "12" ? "2 PM" : "14");
      fireEvent.keyDown(selected, { key: "ArrowDown" });
      expect(change).not.toHaveBeenCalled();
      fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
      expect(change).toHaveBeenCalledWith("15:29");
    } finally {
      window.localStorage.removeItem("tasknotes:calendar-preferences:v1");
    }
  },
);

it("keeps midnight in the 0–23 hour system", () => {
  saveCalendarPreferences({
    ...defaultCalendarPreferences(),
    hourFormat: "24",
  });
  try {
    render(
      <TaskNotesTimePicker
        ariaLabel="Scheduled time"
        value="00:29"
        onChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Scheduled time" }));
    const dialog = screen.getByRole("dialog", { name: "Scheduled time" });
    expect(within(dialog).getByText("00:29")).toBeInTheDocument();
    expect(
      within(within(dialog).getByRole("listbox", { name: "Hour" })).getByRole(
        "option",
        { selected: true },
      ),
    ).toHaveTextContent("00");
  } finally {
    window.localStorage.removeItem("tasknotes:calendar-preferences:v1");
  }
});

it("focuses the selected hour and consumes boundary navigation in each time list", async () => {
  const change = vi.fn();
  render(
    <TaskNotesTimePicker
      ariaLabel="Scheduled time"
      value="16:00"
      onChange={change}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Scheduled time" }));
  const hours = screen.getByRole("listbox", { name: "Hour" });
  const minutes = screen.getByRole("listbox", { name: "Minute" });
  await vi.waitFor(() =>
    expect(within(hours).getByRole("option", { selected: true })).toHaveFocus(),
  );
  for (const [list, last] of [
    [hours, 23],
    [minutes, 59],
  ] as const) {
    const options = within(list).getAllByRole("option");
    const propagated = vi.fn();
    document.body.addEventListener("keydown", propagated);
    const end = new KeyboardEvent("keydown", {
      key: "End",
      bubbles: true,
      cancelable: true,
    });
    fireEvent(options[0]!, end);
    expect(end.defaultPrevented).toBe(true);
    expect(options[last]).toHaveFocus();
    expect(options[last]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(options[last]!, { key: "Home" });
    expect(options[0]).toHaveFocus();
    expect(propagated).not.toHaveBeenCalled();
    document.body.removeEventListener("keydown", propagated);
  }
  expect(change).not.toHaveBeenCalled();
});

it("closes the date sheet from its named header control and returns focus", () => {
  const change = vi.fn();
  render(
    <TaskNotesDatePicker
      ariaLabel="Scheduled date"
      value="2026-07-24"
      onChange={change}
    />,
  );
  const trigger = screen.getByRole("button", { name: "Scheduled date" });
  fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog", {
    name: "Scheduled date calendar",
  });
  fireEvent.click(
    within(dialog).getByRole("button", {
      name: "Close Scheduled date calendar",
    }),
  );
  expect(change).not.toHaveBeenCalled();
  expect(trigger).toHaveFocus();
  expect(trigger).toHaveAttribute("aria-expanded", "false");
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
