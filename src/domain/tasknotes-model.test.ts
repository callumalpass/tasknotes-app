import { describe, expect, it } from "vitest";

import { TaskNotesTaskModel } from "./tasknotes-model";

describe("TaskNotes task model app boundary", () => {
  const model = new TaskNotesTaskModel({
    statuses: [
      status("todo", "To do", 1),
      status("doing", "Doing", 2),
      status("done", "Done", 3, true),
    ],
    priorities: [priority("later", "Later", 1), priority("now", "Now", 2)],
    defaults: { status: "todo", priority: "later", taskTag: "task" },
    userFields: [
      {
        id: "energy",
        key: "energy",
        displayName: "Energy",
        type: "number",
        defaultValue: 2,
      },
      {
        id: "client",
        key: "client",
        displayName: "Client",
        type: "text",
      },
    ],
  });

  it("preserves configured intermediate statuses during ordinary edits", () => {
    const task = model.read({
      path: "tasks/custom.md",
      body: "Notes",
      frontmatter: {
        type: "task",
        id: "custom",
        title: "Original",
        status: "doing",
        priority: "now",
        dateCreated: "2026-07-22T00:00:00.000Z",
        dateModified: "2026-07-22T00:00:00.000Z",
      },
    });

    const updated = model.update(task, {
      title: "Edited",
      status: task.status,
    });

    expect(updated.status).toBe("doing");
    expect(updated.frontmatter.status).toBe("doing");
  });

  it("applies custom defaults and removes cleared custom properties", () => {
    const created = model.create(
      { title: "Configured", customProperties: { client: "Acme" } },
      { id: "configured", now: "2026-07-22T00:00:00.000Z" },
    );
    expect(created.customProperties).toEqual({ energy: 2, client: "Acme" });
    expect(created.frontmatter).toMatchObject({ energy: 2, client: "Acme" });

    const updated = model.update(created, {
      customProperties: { energy: 0 },
    });
    expect(updated.customProperties).toEqual({ energy: 0 });
    expect(updated.frontmatter.energy).toBe(0);
    expect(updated.frontmatter).not.toHaveProperty("client");
  });

  it("persists status, timed dates, and estimates from capture", () => {
    const created = model.create(
      {
        title: "Captured",
        status: "doing",
        scheduled: "2026-08-05T09:00",
        timeEstimate: 45,
      },
      { id: "captured", now: "2026-07-22T00:00:00.000Z" },
    );

    expect(created).toMatchObject({
      status: "doing",
      completed: false,
      scheduled: canonicalLocal("2026-08-05T09:00"),
      timeEstimate: 45,
    });
    expect(created.frontmatter).toMatchObject({
      status: "doing",
      scheduled: canonicalLocal("2026-08-05T09:00"),
      timeEstimate: 45,
    });
  });

  it("completes and skips individual recurring occurrences", () => {
    const created = model.create(
      {
        title: "Standup",
        scheduled: "2026-08-05T09:00",
        recurrence: "FREQ=DAILY;INTERVAL=1",
      },
      { id: "standup", now: "2026-08-01T00:00:00.000Z" },
    );
    const completed = model.toggle(created, {
      now: "2026-08-05T10:00:00.000Z",
      currentDate: "2026-08-05",
    });
    expect(completed.completeInstances).toEqual(["2026-08-05"]);
    expect(completed.scheduled).toBe(canonicalLocal("2026-08-06T09:00"));

    const skipped = model.skip(completed, {
      now: "2026-08-06T10:00:00.000Z",
      currentDate: "2026-08-06",
    });
    expect(skipped.completeInstances).toEqual(["2026-08-05"]);
    expect(skipped.skippedInstances).toEqual(["2026-08-06"]);
    expect(skipped.scheduled).toBe(canonicalLocal("2026-08-07T09:00"));
  });

  it("manages canonical time sessions without losing unknown frontmatter", () => {
    const task = model.read({
      path: "tasks/timed.md",
      body: "Notes",
      frontmatter: {
        type: "task",
        id: "timed",
        title: "Timed task",
        status: "todo",
        priority: "later",
        dateCreated: "2026-07-22T00:00:00Z",
        dateModified: "2026-07-22T00:00:00Z",
        external_owner: "kept",
        time_entries: [
          {
            startTime: "2026-07-22T08:00:00Z",
            endTime: "2026-07-22T08:30:00Z",
            duration: 30,
          },
        ],
      },
    });

    const started = model.startTimeTracking(task, {
      now: "2026-07-22T19:00:00+10:00",
      description: "Review",
    });
    expect(started.timeEntries).toEqual([
      {
        startTime: "2026-07-22T08:00:00Z",
        endTime: "2026-07-22T08:30:00Z",
      },
      { startTime: "2026-07-22T09:00:00Z", description: "Review" },
    ]);
    expect(started.frontmatter.external_owner).toBe("kept");
    expect(started.frontmatter.timeEntries).toEqual(started.timeEntries);
    expect(() => model.startTimeTracking(started)).toThrow(
      /time_tracking_already_active/,
    );

    const stopped = model.stopTimeTracking(started, {
      now: "2026-07-22T09:45:00.987Z",
    });
    expect(stopped.timeEntries[1]).toEqual({
      startTime: "2026-07-22T09:00:00Z",
      endTime: "2026-07-22T09:45:00Z",
      description: "Review",
    });
    expect(() => model.stopTimeTracking(stopped)).toThrow(
      /no_active_time_entry/,
    );
  });

  it("validates, replaces, and deterministically removes time sessions", () => {
    const task = model.create(
      { title: "Sessions" },
      { id: "sessions", now: "2026-07-22T00:00:00Z" },
    );
    const replaced = model.replaceTimeEntries(task, [
      {
        startTime: "2026-07-22T09:00:00+10:00",
        endTime: "2026-07-22T10:00:00+10:00",
        description: "First",
      },
      { startTime: "2026-07-22T11:00:00+10:00" },
    ]);
    expect(replaced.timeEntries).toEqual([
      {
        startTime: "2026-07-21T23:00:00Z",
        endTime: "2026-07-22T00:00:00Z",
        description: "First",
      },
      { startTime: "2026-07-22T01:00:00Z" },
    ]);
    expect(model.removeTimeEntry(replaced, 0).timeEntries).toEqual([
      { startTime: "2026-07-22T01:00:00Z" },
    ]);
    expect(() => model.removeTimeEntry(replaced, 9)).toThrow(/Invalid/);
    expect(() =>
      model.replaceTimeEntries(task, [
        { startTime: "2026-07-22T09:00:00Z" },
        { startTime: "2026-07-22T10:00:00Z" },
      ]),
    ).toThrow(/multiple_active_time_entries/);
    expect(() =>
      model.replaceTimeEntries(task, [
        {
          startTime: "2026-07-22T10:00:00Z",
          endTime: "2026-07-22T09:00:00Z",
        },
      ]),
    ).toThrow(/cannot end before/);
    expect(() =>
      model.replaceTimeEntries(task, [{ startTime: "2026-07-22T10:00:00" }]),
    ).toThrow(/explicit timezone/);
  });

  it("auto-stops only on completion transitions when configured", () => {
    const autoStop = new TaskNotesTaskModel({
      ...model.configuration(),
      timeTracking: {
        ...model.configuration().timeTracking,
        autoStopOnComplete: true,
      },
    });
    const task = autoStop.startTimeTracking(
      autoStop.create(
        { title: "Finish me" },
        { id: "finish-me", now: "2026-07-22T08:00:00Z" },
      ),
      { now: "2026-07-22T09:00:00Z" },
    );
    const completed = autoStop.update(
      task,
      { status: "done" },
      { now: "2026-07-22T10:00:00Z" },
    );
    expect(completed.timeEntries[0].endTime).toBe("2026-07-22T10:00:00Z");

    const alreadyComplete = autoStop.startTimeTracking(completed, {
      now: "2026-07-22T11:00:00Z",
    });
    const edited = autoStop.update(
      alreadyComplete,
      { title: "Still complete" },
      { now: "2026-07-22T12:00:00Z" },
    );
    expect(edited.timeEntries[1].endTime).toBeUndefined();
  });
});

function status(
  value: string,
  label: string,
  order: number,
  isCompleted = false,
) {
  return {
    id: value,
    value,
    label,
    color: "#808080",
    isCompleted,
    order,
    autoArchive: false,
    autoArchiveDelay: 5,
  };
}

function priority(value: string, label: string, weight: number) {
  return { id: value, value, label, color: "#808080", weight };
}

function canonicalLocal(value: string): string {
  return new Date(value).toISOString().replace(".000Z", "Z");
}
