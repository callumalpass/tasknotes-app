import { describe, expect, it } from "vitest";

import { editableFieldSchema } from "./editable-field-schema";

const nullable = (schema: Record<string, unknown>) => ({
  anyOf: [schema, { type: "null" }],
});

describe("editable field schema", () => {
  it.each([
    ["number", { type: "number" }, { type: "number" }],
    ["integer", { type: "integer" }, { type: "number" }],
    ["text", { type: "string" }, { type: "text" }],
    ["boolean", { type: "boolean" }, { type: "boolean" }],
    ["list", { type: "array", items: { type: "string" } }, { type: "list" }],
    ["date", { type: "string", format: "date" }, { type: "date" }],
    [
      "datetime",
      { type: "string", format: "date-time" },
      { type: "text", inputKind: "datetime" },
    ],
  ])("unwraps nested nullable %s fields", (_name, schema, expected) => {
    expect(
      editableFieldSchema(
        nullable(nullable(schema as Record<string, unknown>)),
      ),
    ).toEqual(expected);
  });

  it.each([
    { anyOf: [{ type: "number" }, { type: "string" }] },
    { anyOf: [{ type: "boolean" }, { enum: ["yes", "maybe"] }] },
    { anyOf: [{ type: "string", format: "date" }, { type: "object" }] },
    { anyOf: [{ type: "array", items: { type: "object" } }, { type: "null" }] },
    { anyOf: [{ type: "string" }, {}] },
    { type: ["string", "number"] },
    { type: "null" },
    { anyOf: [] },
  ])("does not infer ambiguous or unsupported unions: %j", (schema) => {
    expect(editableFieldSchema(schema)).toBeNull();
  });
});
