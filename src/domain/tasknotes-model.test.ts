import { describe, expect, it, vi } from "vitest";

import { TaskNotesTaskModel } from "./tasknotes-model";

describe("TaskNotes task model app boundary", () => {
  const model = new TaskNotesTaskModel({
    statuses: [
      status("todo", "To do", 1),
      status("doing", "Doing", 2),
      status("done", "Done", 3, true),
      status("cancelled", "Cancelled", 4, false, true),
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

  it("enforces required fields and protects read-only custom values", () => {
    const schemaModel = new TaskNotesTaskModel({
      ...model.configuration(),
      userFields: [
        {
          id: "owner",
          key: "owner",
          displayName: "Owner",
          type: "text",
          required: true,
        },
        {
          id: "external",
          key: "external",
          displayName: "External ID",
          type: "text",
          readOnly: true,
          defaultValue: "generated",
        },
      ],
    });
    expect(() =>
      schemaModel.create({ title: "Missing owner" }, { id: "missing" }),
    ).toThrow(/required_custom_field: Owner/);

    const created = schemaModel.create(
      {
        title: "Protected",
        customProperties: { owner: "Alex", external: "spoofed" },
      },
      { id: "protected" },
    );
    expect(created.customProperties).toEqual({
      owner: "Alex",
      external: "generated",
    });
    const updated = schemaModel.update(created, {
      customProperties: { owner: "Sam", external: "changed" },
    });
    expect(updated.customProperties).toEqual({
      owner: "Sam",
      external: "generated",
    });
  });

  it("creates canonical paths from the type path pattern", () => {
    const patterned = new TaskNotesTaskModel(model.configuration(), {
      pathPattern: "work/{status}/{id}",
    });
    expect(
      patterned.create({ title: "Patterned" }, { id: "patterned" }).path,
    ).toBe("work/todo/patterned.md");

    const missing = new TaskNotesTaskModel(model.configuration(), {
      pathPattern: "work/{owner}/{id}.md",
    });
    expect(() =>
      missing.create({ title: "Missing path field" }, { id: "missing" }),
    ).toThrow(/path_required/);

    const generated = new TaskNotesTaskModel(model.configuration(), {
      pathPattern: "tasks/{{zettel}}",
    });
    expect(
      generated.create(
        { title: "Generated filename" },
        { id: "generated", now: "2026-07-26T12:34:56" },
      ).path,
    ).toBe("tasks/20260726123456.md");

    const uuid = new TaskNotesTaskModel(model.configuration(), {
      pathPattern: "tasks/{{uuid}}",
    });
    expect(
      uuid.create({ title: "UUID filename" }, { id: "stable-id" }).path,
    ).toBe("tasks/stable-id.md");

    const unsafe = new TaskNotesTaskModel(
      {
        ...model.configuration(),
        userFields: [
          {
            id: "owner",
            key: "owner",
            displayName: "Owner",
            type: "text",
          },
        ],
      },
      { pathPattern: "work/{owner}/{id}.md" },
    );
    expect(() =>
      unsafe.create(
        { title: "Unsafe", customProperties: { owner: ".." } },
        { id: "unsafe" },
      ),
    ).toThrow(/path_invalid/);
  });

  it("rejects custom enum and date-time values outside the schema", () => {
    const schemaModel = new TaskNotesTaskModel({
      ...model.configuration(),
      userFields: [
        {
          id: "owner",
          key: "owner",
          displayName: "Owner",
          type: "text",
          inputKind: "enum",
          options: [{ value: "Alex" }, { value: "Sam" }],
        },
        {
          id: "reviewedAt",
          key: "reviewedAt",
          displayName: "Reviewed At",
          type: "text",
          inputKind: "datetime",
        },
      ],
    });
    expect(() =>
      schemaModel.create(
        { title: "Invalid enum", customProperties: { owner: "Other" } },
        { id: "enum" },
      ),
    ).toThrow(/allowed value/);
    expect(() =>
      schemaModel.create(
        {
          title: "Invalid datetime",
          customProperties: { reviewedAt: "2026-07-22T10:00" },
        },
        { id: "datetime" },
      ),
    ).toThrow(/RFC 3339/);
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

  it("round-trips TaskNotes string ranks through the configured sort field", () => {
    const created = model.create(
      { title: "Ranked", sortOrder: "tnnnnnnnnnnn" },
      { id: "ranked", now: "2026-07-22T00:00:00.000Z" },
    );

    expect(created.sortOrder).toBe("tnnnnnnnnnnn");
    expect(created.frontmatter.tasknotes_manual_order).toBe("tnnnnnnnnnnn");

    const updated = model.update(created, { sortOrder: "tnaaaaaaaaaa" });
    expect(updated.sortOrder).toBe("tnaaaaaaaaaa");
    expect(updated.frontmatter.tasknotes_manual_order).toBe("tnaaaaaaaaaa");
  });

  it("round-trips structured dependencies through the task contract", () => {
    const created = model.create(
      {
        title: "Dependent task",
        blockedBy: [
          {
            uid: " [[tasks/Blocker]] ",
            reltype: "STARTTOSTART",
            gap: " P2D ",
          },
          {
            uid: "[[tasks/Blocker]]",
            reltype: "FINISHTOSTART",
          },
        ],
      },
      { id: "dependent", now: "2026-07-22T00:00:00.000Z" },
    );

    expect(created.blockedBy).toEqual([
      {
        uid: "tasks/Blocker",
        reltype: "STARTTOSTART",
        gap: "P2D",
      },
    ]);
    expect(created.frontmatter.blockedBy).toEqual([
      {
        uid: "[[tasks/Blocker]]",
        reltype: "STARTTOSTART",
        gap: "P2D",
      },
    ]);

    const updated = model.update(created, {
      blockedBy: [
        {
          uid: "[Blocker](/tasks/Blocker.md)",
          reltype: "FINISHTOFINISH",
        },
      ],
    });
    expect(updated.frontmatter.blockedBy).toEqual([
      {
        uid: "[[/tasks/Blocker.md]]",
        reltype: "FINISHTOFINISH",
      },
    ]);
    expect(
      model.read({
        path: updated.path,
        body: updated.body,
        frontmatter: updated.frontmatter,
      }).blockedBy,
    ).toEqual(updated.blockedBy);
  });

  it("round-trips authoritative attachment links without changing the body", () => {
    const created = model.create(
      {
        title: "Documented task",
        body: "The body is presentation, not membership.",
        attachments: ["[[Attachments/diagram.png]]"],
      },
      { id: "documented", now: "2026-07-22T00:00:00.000Z" },
    );

    expect(created.attachments).toEqual(["[[Attachments/diagram.png]]"]);
    expect(created.frontmatter.attachments).toEqual([
      "[[Attachments/diagram.png]]",
    ]);
    expect(created.body).toBe("The body is presentation, not membership.");

    const detached = model.update(created, { attachments: [] });
    expect(detached.attachments).toEqual([]);
    expect(detached.frontmatter).not.toHaveProperty("attachments");
    expect(detached.body).toBe(created.body);
  });

  it("completes and skips individual recurring occurrences", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T00:00:00.000Z"));
    try {
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
    } finally {
      vi.useRealTimers();
    }
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

  it("archives through the configured tag and plans reversible file moves", () => {
    const archivable = new TaskNotesTaskModel({
      ...model.configuration(),
      archive: { moveOnArchive: true, folder: "TaskNotes/Archive" },
    });
    const task = archivable.read({
      path: "tasks/archive-me.md",
      body: "Kept body",
      frontmatter: {
        type: "task",
        id: "archive-me",
        title: "Archive me",
        status: "doing",
        priority: "later",
        dateCreated: "2026-07-22T00:00:00Z",
        dateModified: "2026-07-22T00:00:00Z",
        external_owner: "kept",
        tags: ["task", "history"],
      },
    });

    const archived = archivable.update(
      task,
      { archived: true },
      { now: "2026-07-22T01:00:00Z" },
    );
    expect(archived.archived).toBe(true);
    expect(archived.frontmatter.tags).toEqual(["task", "history", "archived"]);
    expect(archived.frontmatter.external_owner).toBe("kept");
    expect(archivable.archiveDestination(archived, true)).toBe(
      "TaskNotes/Archive/archive-me.md",
    );

    const moved = { ...archived, path: "TaskNotes/Archive/archive-me.md" };
    const restored = archivable.update(
      moved,
      { archived: false },
      { now: "2026-07-22T02:00:00Z" },
    );
    expect(restored.archived).toBe(false);
    expect(restored.frontmatter.tags).toEqual(["task", "history"]);
    expect(archivable.archiveDestination(restored, false)).toBe(
      "tasks/archive-me.md",
    );
  });

  it("materializes an occurrence idempotently and reconciles child state", async () => {
    const parent = model.read({
      path: "tasks/series.md",
      body: "Parent checklist",
      frontmatter: {
        type: "task",
        id: "series",
        title: "Daily review",
        status: "todo",
        priority: "later",
        scheduled: "2026-08-05",
        recurrence: "FREQ=DAILY;INTERVAL=1;DTSTART=20260805",
        occurrence_materialization: "on_completion",
        occurrence_next_trigger: "completion_or_skip",
        dateCreated: "2026-08-01T00:00:00Z",
        dateModified: "2026-08-01T00:00:00Z",
      },
    });
    const materialized = await model.materializeOccurrence(
      parent,
      "2026-08-05",
      [],
      { id: "occurrence", now: "2026-08-05T08:00:00Z" },
    );
    expect(materialized).toMatchObject({ created: true, warnings: [] });
    expect(materialized.task).toMatchObject({
      id: "occurrence",
      recurrenceParent: "[[tasks/series]]",
      occurrenceDate: "2026-08-05",
      scheduled: "2026-08-05",
      recurrence: undefined,
      body: "Parent checklist",
    });
    expect(materialized.task.frontmatter).toMatchObject({
      recurrence_parent: "[[tasks/series]]",
      occurrence_date: "2026-08-05",
    });

    const duplicate = await model.materializeOccurrence(
      parent,
      "2026-08-05",
      [materialized.task],
      { id: "ignored", now: "2026-08-05T08:01:00Z" },
    );
    expect(duplicate).toMatchObject({
      created: false,
      task: { id: "occurrence" },
    });
    expect(() =>
      model.update(
        materialized.task,
        { status: "done" },
        { now: "2026-08-05T08:30:00Z" },
      ),
    ).toThrow(/materialized_occurrence_transition_required/);
    expect(
      model.update(
        materialized.task,
        { status: "doing" },
        { now: "2026-08-05T08:30:00Z" },
      ).status,
    ).toBe("doing");

    const completed = model.transitionMaterializedOccurrence(
      materialized.task,
      parent,
      "toggle",
      { now: "2026-08-05T09:00:00Z" },
    );
    expect(completed.occurrence).toMatchObject({
      completed: true,
      status: "done",
    });
    expect(completed.parent.completeInstances).toContain("2026-08-05");
    expect(completed.materializeNextDate).toBe("2026-08-06");

    const skipped = model.transitionMaterializedOccurrence(
      materialized.task,
      parent,
      "skip",
      { now: "2026-08-05T09:00:00Z" },
    );
    expect(skipped.occurrence).toMatchObject({
      skipped: true,
      status: "cancelled",
    });
    expect(skipped.parent.skippedInstances).toContain("2026-08-05");
    expect(skipped.materializeNextDate).toBe("2026-08-06");
  });

  it("applies occurrence templates while retaining canonical identity", async () => {
    const parent = model.read({
      path: "tasks/template-series.md",
      body: "Parent body",
      frontmatter: {
        type: "task",
        id: "template-series",
        title: "Weekly planning",
        status: "todo",
        priority: "later",
        scheduled: "2026-08-05",
        recurrence: "FREQ=DAILY;INTERVAL=1;DTSTART=20260805",
        occurrence_template: "Templates/Occurrence.md",
        dateCreated: "2026-08-01T00:00:00Z",
        dateModified: "2026-08-01T00:00:00Z",
      },
    });
    const result = await model.materializeOccurrence(
      parent,
      "2026-08-05",
      [],
      { id: "templated-occurrence", now: "2026-08-05T08:00:00Z" },
      async () => `---
title: "{{title}} note"
scheduled: 2026-08-07
external_owner: portable
---
Occurrence body for {{title}}`,
    );
    expect(result.task).toMatchObject({
      title: "Weekly planning note",
      scheduled: "2026-08-07",
      body: "Occurrence body for Weekly planning",
      recurrenceParent: "[[tasks/template-series]]",
      occurrenceDate: "2026-08-05",
    });
    expect(result.task.frontmatter).toMatchObject({
      external_owner: "portable",
      recurrence_parent: "[[tasks/template-series]]",
      occurrence_date: "2026-08-05",
    });
  });
});

function status(
  value: string,
  label: string,
  order: number,
  isCompleted = false,
  isSkipped = false,
) {
  return {
    id: value,
    value,
    label,
    color: "#808080",
    isCompleted,
    isSkipped,
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
