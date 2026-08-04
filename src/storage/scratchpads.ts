import {
  ACTIVE_SCRATCHPAD_PATH,
  SCRATCHPAD_TYPE,
  type ScratchpadDocument,
  type ScratchpadState,
} from "../domain/scratchpad";

export interface ScratchpadRecordLike {
  path: string;
  revision: string;
  frontmatter: Record<string, unknown>;
  body?: string;
  types?: readonly string[];
}

export function scratchpadFromRecord(
  record: ScratchpadRecordLike,
): ScratchpadDocument {
  const frontmatter = record.frontmatter;
  if (
    frontmatter.type !== SCRATCHPAD_TYPE &&
    !record.types?.includes(SCRATCHPAD_TYPE)
  )
    throw new Error(`${record.path} is not a TaskNotes scratchpad.`);
  const state = requiredString(frontmatter, "state");
  if (state !== "active" && state !== "converted")
    throw new Error(`${record.path} has an invalid scratchpad state.`);
  return {
    id: requiredString(frontmatter, "id"),
    path: record.path,
    revision: record.revision,
    state,
    dateCreated: requiredString(frontmatter, "dateCreated"),
    dateModified: requiredString(frontmatter, "dateModified"),
    ...(typeof frontmatter.dateConverted === "string"
      ? { dateConverted: frontmatter.dateConverted }
      : {}),
    ...(typeof frontmatter.title === "string"
      ? { title: frontmatter.title }
      : {}),
    body: record.body ?? "",
  };
}

export function newScratchpadValues(now = new Date().toISOString()): {
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
} {
  return {
    path: ACTIVE_SCRATCHPAD_PATH,
    frontmatter: {
      type: SCRATCHPAD_TYPE,
      id: crypto.randomUUID(),
      state: "active",
      dateCreated: now,
      dateModified: now,
    },
    body: "",
  };
}

export function scratchpadFrontmatter(
  current: ScratchpadDocument,
  input: {
    state?: ScratchpadState;
    title?: string;
    dateModified: string;
    dateConverted?: string;
  },
): Record<string, unknown> {
  const state = input.state ?? current.state;
  return {
    type: SCRATCHPAD_TYPE,
    id: current.id,
    state,
    ...(input.title?.trim() ? { title: input.title.trim() } : {}),
    dateCreated: current.dateCreated,
    dateModified: input.dateModified,
    ...(input.dateConverted ? { dateConverted: input.dateConverted } : {}),
  };
}

export function activeScratchpad(
  records: readonly ScratchpadRecordLike[],
): ScratchpadDocument | undefined {
  const active = records
    .map(scratchpadFromRecord)
    .filter((document) => document.state === "active");
  if (active.length > 1)
    throw new Error(
      "More than one active scratchpad was found. Move or merge one before continuing.",
    );
  return active[0];
}

export function assertScratchpadRevision(
  current: ScratchpadDocument,
  input: { id: string; revision: string },
): void {
  assertScratchpadIdentity(current, input);
  if (input.revision !== current.revision)
    throw new Error(
      "This scratchpad changed after it was opened. Reload it before saving.",
    );
}

function assertScratchpadIdentity(
  current: ScratchpadDocument,
  input: { id: string },
): void {
  if (current.id !== input.id)
    throw new Error("The active scratchpad changed. Reload it before saving.");
  if (current.state !== "active")
    throw new Error("A converted scratchpad cannot be changed here.");
}

/**
 * Accept a hosted replica revision advance only when it acknowledged the exact
 * body the editor was already based on. A different body remains a real edit
 * conflict, even when the editor's revision is merely stale.
 */
export function assertScratchpadRebase(
  current: ScratchpadDocument,
  input: { id: string; revision: string; baseBody: string },
): void {
  assertScratchpadIdentity(current, input);
  if (input.revision !== current.revision && input.baseBody !== current.body)
    throw new Error(
      "This scratchpad changed after it was opened. Reload it before saving.",
    );
}

function requiredString(
  frontmatter: Record<string, unknown>,
  property: string,
): string {
  const value = frontmatter[property];
  if (typeof value !== "string" || !value.trim())
    throw new Error(`Scratchpad ${property} must be a non-empty string.`);
  return value;
}
