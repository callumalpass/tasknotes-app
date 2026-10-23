import { describe, expect, it } from "vitest";
import { TaskNotesTaskModel } from "./tasknotes-model";
import { desiredTaskTimers } from "./reminder-timers";

const model = new TaskNotesTaskModel();
const now = Date.parse("2099-08-01T00:00:00Z");
const future = "2099-08-06T09:00:00Z";
const reminder = {
  id: "absolute",
  type: "absolute" as const,
  absoluteTime: future,
};

describe("content-free reminder membership", () => {
  it("keeps stable identity through content, path and fire-time edits", async () => {
    const task = model.create(
      { title: "Private title", body: "Private body", reminders: [reminder] },
      { id: crypto.randomUUID() },
    );
    const first = await desiredTaskTimers([task]);
    const second = await desiredTaskTimers([
      {
        ...task,
        title: "Renamed",
        path: "Elsewhere.md",
        reminders: [{ ...reminder, absoluteTime: "2099-08-07T09:00:00Z" }],
      },
    ]);
    expect(first).toEqual([
      {
        id: expect.stringMatching(/^[a-f0-9]{64}$/),
        fireAt: "2099-08-06T09:00:00.000Z",
      },
    ]);
    expect(second[0]!.id).toBe(first[0]!.id);
    expect(second[0]!.fireAt).toBe("2099-08-07T09:00:00.000Z");
    const changedIdentity = await desiredTaskTimers([
      { ...task, reminders: [{ ...reminder, id: "another" }] },
    ]);
    expect(changedIdentity[0]!.id).not.toBe(first[0]!.id);
  });

  it("omits completed, archived and invalid reminders", async () => {
    const task = model.create(
      { title: "Task", reminders: [reminder] },
      { id: crypto.randomUUID() },
    );
    expect(
      await desiredTaskTimers([
        { ...task, completed: true },
        { ...task, archived: true },
        {
          ...task,
          reminders: [
            { ...reminder, absoluteTime: "invalid" },
            {
              id: "missing",
              type: "relative",
              relatedTo: "due",
              offset: "-PT15M",
            },
          ],
        },
      ]),
    ).toEqual([]);
  });

  it("includes overdue and exactly-now membership for authority-side history handling", async () => {
    const task = model.create(
      {
        title: "Still active",
        reminders: [
          {
            ...reminder,
            id: "past",
            absoluteTime: new Date(now - 1).toISOString(),
          },
          { ...reminder, id: "now", absoluteTime: new Date(now).toISOString() },
        ],
      },
      { id: crypto.randomUUID() },
    );
    expect(
      (await desiredTaskTimers([task])).map((timer) => timer.fireAt),
    ).toEqual([new Date(now - 1).toISOString(), new Date(now).toISOString()]);
    expect(await desiredTaskTimers([{ ...task, completed: true }])).toEqual([]);
  });

  it("retains due/scheduled offsets and device-local midnight for date-only anchors", async () => {
    const task = model.create(
      {
        title: "Offsets",
        due: "2099-08-06",
        scheduled: future,
        reminders: [
          { id: "due", type: "relative", relatedTo: "due", offset: "-P1D" },
          {
            id: "scheduled",
            type: "relative",
            relatedTo: "scheduled",
            offset: "-PT15M",
          },
        ],
      },
      { id: crypto.randomUUID() },
    );
    const timers = await desiredTaskTimers([task]);
    expect(timers.map((timer) => timer.fireAt)).toEqual([
      new Date(2099, 7, 5, 0, 0, 0).toISOString(),
      "2099-08-06T08:45:00.000Z",
    ]);
  });
});
