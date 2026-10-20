import { parse } from "yaml";
import { parseFrontmatter } from "@tasknotes/model/frontmatter";
import type { AppBasesDescriptor } from "@mdbase-dev/sdk/app-host";
import { normalizePresentationType } from "../domain/view-renderer";
import type { TaskView } from "../domain/view";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Native view source has invalid presentation metadata.");
  return value as Record<string, unknown>;
}

/** Read display metadata from ONE exact, native-validated current source.
 * Native owns admission/filter/sort/group execution. Never remap declaration
 * ordinals by supported-view subset, display name, path or JS evaluation. */
export function nativePresentation(
  source: string,
  descriptor: AppBasesDescriptor,
  columns: readonly string[],
): {
  properties: TaskView["properties"];
  presentation: NonNullable<TaskView["presentation"]>;
  groupProperty?: string;
} {
  const root = object(
    source.startsWith("---")
      ? parseFrontmatter(source).frontmatter
      : parse(source),
  );
  if (!Array.isArray(root.views))
    throw new Error("Native view source has no declaration array.");
  const selected = object(root.views[descriptor.ordinal]);
  if (
    (typeof selected.name === "string" ? selected.name : null) !==
    descriptor.name
  )
    throw new Error(
      "Native source declaration differs from its original ordinal.",
    );
  const definitions =
    root.properties === undefined ? {} : object(root.properties);
  const properties = columns.map((key) => {
    const raw = definitions[key] === undefined ? {} : object(definitions[key]);
    return {
      key,
      ...(typeof raw.displayName === "string"
        ? { label: raw.displayName }
        : {}),
      ...(typeof raw.hidden === "boolean" ? { hidden: raw.hidden } : {}),
    };
  });
  const group = selected.groupBy;
  const groupProperty =
    typeof group === "string"
      ? group
      : group === undefined
        ? undefined
        : object(group).property;
  if (groupProperty !== undefined && typeof groupProperty !== "string")
    throw new Error("Native source has invalid group presentation metadata.");
  const mappings: Record<string, string> = {};
  if (selected.mappings !== undefined) {
    for (const [key, value] of Object.entries(object(selected.mappings))) {
      if (typeof value !== "string")
        throw new Error("Native source has invalid renderer mappings.");
      mappings[key] = value;
    }
  }
  const type = normalizePresentationType(descriptor.viewType);
  if (
    type === "tasknotes.kanban" &&
    groupProperty !== undefined &&
    mappings.column === undefined
  )
    mappings.column = groupProperty;
  return {
    properties,
    ...(groupProperty === undefined ? {} : { groupProperty }),
    presentation: {
      type,
      mappings,
      options:
        selected.options === undefined
          ? {}
          : structuredClone(object(selected.options)),
    },
  };
}
