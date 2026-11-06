import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { resolveTaskTypeDefinition } from "./tasknotes-collection";

import customType from "../../tests/fixtures/mdbase-upgrades/app-custom/task.md?raw";
import customRecord from "../../tests/fixtures/mdbase-upgrades/app-custom/record.json";
import userfieldsType from "../../tests/fixtures/mdbase-upgrades/matrix-userfields/task.md?raw";

function definition(document: string): Record<string, unknown> {
  return parse(document.split("---")[1]);
}

describe("real migrated TaskNotes type bootstrap", () => {
  it("keeps a mapped role when the schema still names its contract field", () => {
    const { model } = resolveTaskTypeDefinition({
      name: "task",
      schema: {
        value: {
          type: "object",
          properties: {
            status: { enum: ["active", "completed"], default: "active" },
            deadline: { type: "string" },
            "created-date": { type: "string" },
            "modified-date": { type: "string" },
            "completed-date": { type: "string" },
            due: { type: "string" },
            dateCreated: { type: "string" },
            completedDate: { type: "string" },
            recurrence_anchor: { type: "string" },
            effort: { type: "number" },
          },
        },
      },
      implements: [
        {
          contract: "tasknotes.task",
          version: "0.3.0-rc.6",
          fields: {
            status: "status",
            due: "deadline",
            dateCreated: "created-date",
            dateModified: "modified-date",
            completedDate: "completed-date",
          },
          binding: {
            status: {
              values: ["active", "completed"],
              default: "active",
              completed_values: ["completed"],
            },
          },
        },
      ],
    });
    expect(model.config.userFields.map(({ key }) => key)).toEqual(["effort"]);

    const task = model.read({
      path: "tasks/a.md",
      body: "",
      frontmatter: {
        title: "A",
        status: "active",
        tags: ["task"],
        deadline: "2026-11-09",
        "created-date": "2026-11-01T00:00:00Z",
        "modified-date": "2026-11-01T00:00:00Z",
      },
    });
    expect(task.due).toBe("2026-11-09");

    const done = model.toggle(task, { currentDate: "2026-11-06" });
    expect(done.frontmatter["completed-date"]).toBe("2026-11-06");
    expect(done.frontmatter).not.toHaveProperty("completedDate");
    expect(
      model.read({ path: task.path, body: "", frontmatter: done.frontmatter })
        .completedDate,
    ).toBe("2026-11-06");
  });

  it("exposes Effort and reads its captured value without modifying the schema", () => {
    const type = definition(customType);
    const before = structuredClone(type);
    const { model } = resolveTaskTypeDefinition(type);
    const record = structuredClone(customRecord);
    const task = model.read(record);
    expect(model.config.userFields).toContainEqual({
      id: "schema:effort",
      key: "effort",
      displayName: "Effort",
      type: "number",
    });
    expect(task.customProperties.effort).toBe(0.5);
    expect(task.frontmatter.effort).toBe(0.5);
    expect(task.body).toBe(record.body);
    expect(type).toEqual(before);
    const updated = model.update(task, { customProperties: { effort: 2 } });
    expect(updated.frontmatter.effort).toBe(2);
    expect(updated.body).toBe(record.body);
  });

  it("infers all five captured migrated custom-field kinds", () => {
    const { model } = resolveTaskTypeDefinition(definition(userfieldsType));
    expect(
      model.config.userFields.map(({ key, type }) => ({ key, type })),
    ).toEqual([
      { key: "custom_text", type: "text" },
      { key: "custom_number", type: "number" },
      { key: "custom_date", type: "date" },
      { key: "custom_boolean", type: "boolean" },
      { key: "custom_list", type: "list" },
    ]);
    const values = {
      custom_text: "Client",
      custom_number: 0.5,
      custom_date: "2026-10-02",
      custom_boolean: false,
      custom_list: ["one", "two"],
    };
    const task = model.read({
      path: "tasks/migrated.md",
      body: "Preserve me",
      frontmatter: {
        tags: ["task"],
        status: "open",
        dateCreated: "2026-10-02T00:00:00Z",
        dateModified: "2026-10-02T00:00:00Z",
        ...values,
      },
    });
    expect(task.customProperties).toEqual(values);
  });
});
