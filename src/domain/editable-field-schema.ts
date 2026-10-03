import type { UserMappedFieldType } from "@tasknotes/model/types";

type Shape =
  | "text"
  | "number"
  | "numeric-text"
  | "boolean"
  | "boolean-text"
  | "date"
  | "datetime"
  | "list";

export interface EditableFieldSchema {
  type: UserMappedFieldType;
  inputKind?: "datetime";
}

// These are the v4 migration's persisted-value coercion schemas, not a
// general rule that a union containing a number should use a number editor.
const numericPatterns = new Set([
  "^-?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?$",
  "^-?(?:0|[1-9][0-9]*)(?:\\.0+)?$",
]);
const timestampPattern =
  "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})?$";
const booleanStrings = new Set(["true", "false", "yes", "no", "on", "off"]);

export function editableFieldSchema(
  property: Record<string, unknown>,
): EditableFieldSchema | null {
  const variants = shapes(property);
  if (!variants || !variants.length) return null;
  const kinds = new Set(variants);
  if (kinds.has("number") && only(kinds, ["number", "numeric-text"]))
    return { type: "number" };
  if (kinds.has("boolean") && only(kinds, ["boolean", "boolean-text"]))
    return { type: "boolean" };
  if (kinds.has("date") && only(kinds, ["date", "datetime"]))
    return { type: "date" };
  if (only(kinds, ["datetime"])) return { type: "text", inputKind: "datetime" };
  if (only(kinds, ["text", "numeric-text", "boolean-text"]))
    return { type: "text" };
  if (only(kinds, ["list"])) return { type: "list" };
  return null;
}

function shapes(property: Record<string, unknown>): Shape[] | null {
  if (Array.isArray(property.anyOf)) {
    const result: Shape[] = [];
    for (const variant of property.anyOf) {
      const nested = shapes(record(variant));
      if (!nested) return null;
      result.push(...nested);
    }
    return result;
  }
  if (Array.isArray(property.type)) {
    const types = property.type.filter((type) => type !== "null");
    // v4 text fields and text-list items accept scalar values for coercion.
    if (
      types.includes("string") &&
      types.includes("number") &&
      types.includes("boolean") &&
      types.every((type) => ["string", "number", "boolean"].includes(type))
    )
      return ["text"];
    if (types.length === 1) return shapes({ ...property, type: types[0] });
    return null;
  }
  if (property.type === "null") return [];
  if (property.type === "number" || property.type === "integer")
    return ["number"];
  if (property.type === "boolean") return ["boolean"];
  if (property.type === "array") {
    const item = editableFieldSchema(record(property.items));
    return item?.type === "text" || item?.type === "date" ? ["list"] : null;
  }
  if (property.type === "string") {
    if (property.format === "date") return ["date"];
    if (
      property.format === "date-time" ||
      property.pattern === timestampPattern
    )
      return ["datetime"];
    if (
      typeof property.pattern === "string" &&
      numericPatterns.has(property.pattern)
    )
      return ["numeric-text"];
    return ["text"];
  }
  if (
    Array.isArray(property.enum) &&
    property.enum.length &&
    property.enum.every((value) => typeof value === "string")
  )
    return [
      property.enum.every((value) => booleanStrings.has(value))
        ? "boolean-text"
        : "text",
    ];
  return null;
}

function only(kinds: Set<Shape>, allowed: Shape[]): boolean {
  return [...kinds].every((kind) => allowed.includes(kind));
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
