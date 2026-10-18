import { describe, expect, it } from "vitest";
import { TaskNotesTaskModel } from "../domain/tasknotes-model";
import { field, fieldOptions, viewFields } from "./view-editor-fields";

describe("view editor field catalog", () => {
  it("keeps first-wins ordering and canonical options beside mapped fields", () => {
    const configuration = new TaskNotesTaskModel().configuration();
    configuration.fieldMapping.status = "state";
    configuration.userFields = [
      { id: "effort", key: "effort", displayName: "Effort", type: "number" },
    ];
    const fields = viewFields(configuration, [
      "status",
      "effort",
      "note.extra",
    ]);
    expect(fields[0]).toEqual(field("title", "Title"));
    expect(fields.filter(({ key }) => key === "status")).toHaveLength(1);
    expect(fields.find(({ key }) => key === "status")?.options).toEqual(
      configuration.statuses.map(({ value, label }) => ({ value, label })),
    );
    expect(fields.find(({ key }) => key === "state")).toEqual(
      field("state", "Status"),
    );
    expect(fields.find(({ key }) => key === "effort")).toEqual(
      field("effort", "Effort", "number"),
    );
    expect(fields.at(-1)).toEqual(field("note.extra", "Extra"));
    expect(fieldOptions([fields[0]])).toEqual([
      { value: "title", label: "Title" },
    ]);
  });
});
