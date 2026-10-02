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
