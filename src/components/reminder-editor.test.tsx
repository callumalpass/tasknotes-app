import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ReminderEditor } from "./reminder-editor";

import type { TaskReminder } from "../domain/task";

describe("ReminderEditor", () => {
  it("adds, edits, and removes multiple relative reminders", () => {
    const changed = vi.fn();

    function Harness() {
      const [reminders, setReminders] = useState<TaskReminder[]>([
        {
          id: "absolute",
          type: "absolute",
          absoluteTime: "2026-08-05T08:00:00Z",
        },
        {
          id: "relative",
          type: "relative",
          relatedTo: "due",
          offset: "-PT15M",
        },
      ]);
      return (
        <ReminderEditor
          due="2026-08-06T17:00:00+10:00"
          reminders={reminders}
          scheduled="2026-08-05T09:00:00+10:00"
          onChange={(next) => {
            changed(next);
            setReminders(next);
          }}
        />
      );
    }

    render(<Harness />);
    expect(screen.getAllByRole("region", { name: /Reminder \d/ })).toHaveLength(
      2,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Add 1 hour before due",
      }),
    );
    expect(screen.getAllByRole("region", { name: /Reminder \d/ })).toHaveLength(
      3,
    );
    expect(changed.mock.lastCall?.[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "relative",
          relatedTo: "due",
          offset: "-PT1H",
        }),
      ]),
    );

    const second = screen.getByRole("region", { name: "Reminder 2" });
    fireEvent.change(within(second).getByLabelText("Amount"), {
      target: { value: "30" },
    });
    expect(changed.mock.lastCall?.[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "relative", offset: "-PT30M" }),
      ]),
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove reminder 1" }));
    expect(screen.getAllByRole("region", { name: /Reminder \d/ })).toHaveLength(
      2,
    );
    expect(changed.mock.lastCall?.[0]).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "absolute" })]),
    );
  });

  it("defaults to a valid absolute reminder when no anchor date exists", () => {
    const changed = vi.fn();
    render(<ReminderEditor reminders={[]} onChange={changed} />);

    fireEvent.click(screen.getByRole("button", { name: "Add reminder" }));

    expect(changed).toHaveBeenCalledWith([
      expect.objectContaining({
        type: "absolute",
        absoluteTime: expect.stringMatching(/Z$/),
      }),
    ]);
  });
});
