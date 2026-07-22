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
  if (!managed) {
    return { changed: false, frontmatter: source, completedField };
  }

  let frontmatter = source;
  let changed = false;
  if (completedProperty.format === "date-time") {
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
    frontmatter = {
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
    };
    changed = true;
  }
  const occurrence = upgradeOccurrenceContract(frontmatter, statusField);
  return {
    changed: changed || occurrence.changed,
    completedField,
    frontmatter: occurrence.frontmatter,
  };
}

function upgradeOccurrenceContract(
  source: Record<string, unknown>,
  statusField: string,
): { changed: boolean; frontmatter: Record<string, unknown> } {
  const extension = record(source["x-tasknotes"]);
  const status = record(extension.status);
  const values = stringList(status.values);
  const usesAppDefaults =
    values.includes("open") &&
    values.includes("done") &&
    values.every((value) =>
      ["none", "open", "in-progress", "done", "cancelled"].includes(value),
    );
  const nextValues =
    usesAppDefaults && !values.includes("cancelled")
      ? [...values, "cancelled"]
      : values;
  const profiles = stringList(extension.profiles);
  const nextProfiles = [
    ...new Set([...profiles, "recurrence", "materialized-occurrences"]),
  ];
  const nextStatus = usesAppDefaults
    ? {
        ...status,
        values: nextValues,
        skipped_values: ["cancelled"],
        default_skipped: "cancelled",
      }
    : status;
  const schema = record(source.schema);
  const schemaValue = record(schema.value);
  const properties = record(schemaValue.properties);
  const statusProperty = record(properties[statusField]);
  const nextStatusProperty =
    usesAppDefaults && Array.isArray(statusProperty.enum)
      ? { ...statusProperty, enum: nextValues }
      : statusProperty;
  const frontmatter = {
    ...source,
    schema: {
      ...schema,
      value: {
        ...schemaValue,
        properties: { ...properties, [statusField]: nextStatusProperty },
      },
    },
    "x-tasknotes": {
      ...extension,
      profiles: nextProfiles,
      status: nextStatus,
      occurrences: {
        default_materialization: "manual",
        default_next_trigger: "completion",
        past_horizon: "P0D",
        future_horizon: "P14D",
        ...record(extension.occurrences),
      },
    },
  };
  return {
    changed: JSON.stringify(frontmatter) !== JSON.stringify(source),
    frontmatter,
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

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}
