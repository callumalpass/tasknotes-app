import { mutationFingerprint } from "@mdbase-dev/connect-protocol";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ReminderEditor } from "./reminder-editor";

import type { TaskReminder } from "../domain/task";

describe("ReminderEditor", () => {
  it("adds, edits, and removes multiple relative reminders", async () => {
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

    await expect(
      mutationFingerprint("update", {
        patch: { reminders: changed.mock.lastCall?.[0] },
      }),
    ).resolves.toEqual(expect.any(String));

    fireEvent.click(screen.getByRole("button", { name: "Remove reminder 1" }));
    expect(screen.getAllByRole("region", { name: /Reminder \d/ })).toHaveLength(
      2,
    );
    expect(changed.mock.lastCall?.[0]).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "absolute" })]),
    );
  });

  it("emits JSON-safe fixed reminder edits without losing identity or description", async () => {
    const changed = vi.fn();
    render(
      <ReminderEditor
        reminders={[
          {
            id: "fixed",
            type: "absolute",
            absoluteTime: "2026-08-05T08:00:00Z",
            description: "Keep this description",
          },
        ]}
        onChange={changed}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reminder time" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Now",
      }),
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Done",
      }),
    );

    const reminders = changed.mock.lastCall?.[0];
    expect(reminders).toEqual([
      expect.objectContaining({
        id: "fixed",
        type: "absolute",
        description: "Keep this description",
        absoluteTime: expect.stringMatching(/Z$/),
      }),
    ]);
    expect(reminders[0]).not.toHaveProperty("relatedTo");
    expect(reminders[0]).not.toHaveProperty("offset");
    await expect(
      mutationFingerprint("update", { patch: { reminders } }),
    ).resolves.toEqual(expect.any(String));
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

  it("explains when reminder notifications cannot be delivered", () => {
    render(
      <ReminderEditor deliveryMode="local" reminders={[]} onChange={vi.fn()} />,
    );

    expect(screen.getByRole("note")).toHaveTextContent(
      "Notifications are not available here",
    );
    expect(screen.getByRole("note")).toHaveTextContent(
      "tasks stored on this device cannot deliver notifications",
    );
    expect(
      screen.queryByRole("button", { name: "Connect mdbase" }),
    ).not.toBeInTheDocument();
  });

  it("delivers notifications for every mdbase connection style", () => {
    render(
      <ReminderEditor
        deliveryMode="mdbase"
        reminders={[]}
        onChange={vi.fn()}
      />,
    );

    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.getByText(/Notify at a fixed time/)).toBeVisible();
  });
});
