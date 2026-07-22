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
      scheduled: "2026-08-05T09:00",
      timeEstimate: 45,
    });
    expect(created.frontmatter).toMatchObject({
      status: "doing",
      scheduled: "2026-08-05T09:00",
      timeEstimate: 45,
    });
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
