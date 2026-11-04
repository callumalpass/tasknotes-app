import type {
  TaskCollectionConfiguration,
  TaskUserMappedField,
} from "../domain/task-configuration";

export type EditableProperty =
  | {
      kind: "status" | "priority" | "scheduled" | "due" | "recurrence";
      key: string;
    }
  | { kind: "custom"; key: string; field: TaskUserMappedField };

export function editableProperty(
  key: string,
  configuration: TaskCollectionConfiguration,
): EditableProperty | null {
  if (key.startsWith("file.")) return null;
  const normalized = notePropertyName(key);
  const semantic = (
    ["status", "priority", "scheduled", "due", "recurrence"] as const
  ).find(
    (kind) =>
      normalized === kind || normalized === configuration.fieldMapping[kind],
  );
  if (semantic) return { kind: semantic, key: normalized };
  const field = configuration.userFields.find(
    (candidate) => candidate.key === normalized,
  );
  return field && !field.readOnly
    ? { kind: "custom", key: normalized, field }
    : null;
}

export function notePropertyName(key: string): string {
  if (key.startsWith("note.")) return key.slice(5);
  return /^note\[(["'])(.+)\1\]$/.exec(key)?.[2] ?? key;
}

export function canEditProperty(
  key: string,
  configuration: TaskCollectionConfiguration,
): boolean {
  return editableProperty(key, configuration) !== null;
}
