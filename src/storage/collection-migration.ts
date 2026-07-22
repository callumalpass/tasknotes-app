export interface ManagedTypeUpgrade {
  changed: boolean;
  frontmatter: Record<string, unknown>;
  completedField: string;
}

export function upgradeManagedTaskType(
  source: Record<string, unknown>,
): ManagedTypeUpgrade {
  const schema = record(source.schema);
  const value = record(schema.value);
  const properties = record(value.properties);
  const extension = record(source["x-tasknotes"]);
  const roles = record(extension.field_roles);
  const completedField = stringValue(roles.completedDate) ?? "completedDate";
  const statusField = stringValue(roles.status) ?? "status";
  const recurrenceField = stringValue(roles.recurrence) ?? "recurrence";
  const completedProperty = record(properties[completedField]);
  const managed =
    source.description === "A TaskNotes-compatible task." &&
    record(properties.mobileRevision).type === "integer" &&
    extension.contract === "tasknotes.task";
  if (!managed || completedProperty.format !== "date-time") {
    return { changed: false, frontmatter: source, completedField };
  }

  const rawCompletedValues = record(extension.status).completed_values;
  const completedValues = Array.isArray(rawCompletedValues)
    ? rawCompletedValues.filter(
        (candidate): candidate is string => typeof candidate === "string",
      )
    : ["done"];
  const required = Array.isArray(value.required)
    ? [...new Set([...value.required, statusField])]
    : [
        "type",
        "id",
        roles.title ?? "title",
        statusField,
        roles.dateCreated ?? "dateCreated",
        roles.dateModified ?? "dateModified",
      ];
  return {
    changed: true,
    completedField,
    frontmatter: {
      ...source,
      schema: {
        ...schema,
        value: {
          ...value,
          required,
          properties: {
            ...properties,
            [completedField]: { ...completedProperty, format: "date" },
          },
          allOf: [
            {
              if: {
                required: [statusField],
                properties: { [statusField]: { enum: completedValues } },
                not: { required: [recurrenceField] },
              },
              then: { required: [completedField] },
            },
          ],
        },
      },
    },
  };
}

export function upgradeManagedTaskDocument(
  source: Record<string, unknown>,
  completedField: string,
): { changed: boolean; frontmatter: Record<string, unknown> } {
  const value = source[completedField];
  if (typeof value !== "string") return { changed: false, frontmatter: source };
  const match = /^(\d{4}-\d{2}-\d{2})T/.exec(value);
  if (!match) return { changed: false, frontmatter: source };
  return {
    changed: true,
    frontmatter: { ...source, [completedField]: match[1] },
  };
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
