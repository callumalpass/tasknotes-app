import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { RecurrenceField } from "./recurrence-field";

describe("RecurrenceField", () => {
  it("edits weekday rules visually without losing BYDAY", () => {
    const changed = vi.fn();

    function Harness() {
      const [value, setValue] = useState<string | undefined>(
        "DTSTART:20300805;FREQ=DAILY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR",
      );
      return (
        <RecurrenceField
          anchor="scheduled"
          scheduled="2030-08-05"
          value={value}
          onAnchorChange={vi.fn()}
          onChange={(next) => {
            changed(next);
            setValue(next);
          }}
        />
      );
    }

    render(<Harness />);
    expect(
      screen.getByText(
        "Every day on Monday, Tuesday, Wednesday, Thursday, and Friday",
      ),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Edit pattern" }));
    expect(screen.getByRole("button", { name: "Monday" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Repeat interval" }),
      {
        target: { value: "2" },
      },
    );

    expect(changed).toHaveBeenLastCalledWith(
      "DTSTART:20300805;FREQ=DAILY;INTERVAL=2;BYDAY=MO,TU,WE,TH,FR",
    );
    expect(
      screen.getByText(
        "Every 2 days on Monday, Tuesday, Wednesday, Thursday, and Friday",
      ),
    ).toBeVisible();
  });

  it("builds ordinal monthly and yearly patterns", () => {
    function Harness() {
      const [value, setValue] = useState<string | undefined>(
        "DTSTART:20300801;FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=1",
      );
      return (
        <RecurrenceField
          value={value}
          onAnchorChange={vi.fn()}
          onChange={setValue}
        />
      );
    }

    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Edit pattern" }));
    choose("Each month", "A weekday position");
    choose("Which", "Last");
    choose("Weekday", "Friday");
    expect(screen.getByText("Every month on the last Friday")).toBeVisible();

    choose("Repeat frequency", "year");
    choose("Month", "August");
    expect(
      screen.getByText("Every year on the last Friday of August"),
    ).toBeVisible();
  });

  it("keeps advanced rules unchanged until a valid edit is applied", () => {
    const changed = vi.fn();
    render(
      <RecurrenceField
        value="DTSTART:20300801;FREQ=MONTHLY;BYDAY=MO,TU;BYSETPOS=2"
        onAnchorChange={vi.fn()}
        onChange={changed}
      />,
    );

    expect(screen.getByText("Advanced recurrence rule")).toBeVisible();
    const rule = screen.getByLabelText("Recurrence rule");
    fireEvent.change(rule, { target: { value: "FREQ=" } });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "“FREQ=” is not a valid RRULE part.",
    );
    expect(screen.getByRole("button", { name: "Apply rule" })).toBeDisabled();
    expect(changed).not.toHaveBeenCalled();

    fireEvent.change(rule, {
      target: { value: "DTSTART:20300801;FREQ=MONTHLY;BYDAY=-1FR" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply rule" }));
    expect(changed).toHaveBeenCalledWith(
      "DTSTART:20300801;FREQ=MONTHLY;BYDAY=-1FR",
    );
  });

  it("creates a complete preset from the scheduled value", () => {
    const changed = vi.fn();
    render(
      <RecurrenceField
        scheduled="2030-08-05T09:30"
        onAnchorChange={vi.fn()}
        onChange={changed}
      />,
    );

    choose("Repeat", "Weekly");
    expect(changed).toHaveBeenCalledWith(
      "DTSTART:20300805T093000Z;FREQ=WEEKLY;INTERVAL=1;BYDAY=MO",
    );
  });

  it("shows and preserves an effective start for legacy rules", () => {
    const changed = vi.fn();
    render(
      <RecurrenceField
        scheduled="2030-08-05"
        value="FREQ=WEEKLY;BYDAY=MO"
        onAnchorChange={vi.fn()}
        onChange={changed}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit pattern" }));
    expect(
      screen.getByRole("button", { name: "Pattern starts date" }),
    ).toHaveAttribute("data-value", "2030-08-05");
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Repeat interval" }),
      {
        target: { value: "2" },
      },
    );
    expect(changed).toHaveBeenCalledWith(
      "DTSTART:20300805;FREQ=WEEKLY;INTERVAL=2;BYDAY=MO",
    );
  });
});

function choose(label: string, option: string) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  const list = screen.getByRole("listbox", { name: label });
  fireEvent.click(within(list).getByRole("option", { name: option }));
}
