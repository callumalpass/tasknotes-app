import {
  SCRATCHPAD_TYPE,
  scratchpadDocumentPath,
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
  const id = crypto.randomUUID();
  return {
    path: scratchpadDocumentPath(new Date(now), id),
    frontmatter: {
      type: SCRATCHPAD_TYPE,
      id,
      // The authority's on_create lifecycle may replace id. This token binds
      // a reserved path to its recoverable creation intent independently.
      scratchpadReservationId: id,
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
  const title =
    input.title === undefined ? current.title?.trim() : input.title.trim();
  return {
    type: SCRATCHPAD_TYPE,
    id: current.id,
    state,
    ...(title !== undefined ? { title } : {}),
    dateCreated: current.dateCreated,
    dateModified: input.dateModified,
    ...(input.dateConverted ? { dateConverted: input.dateConverted } : {}),
  };
}

export function assertScratchpadRevision(
  current: ScratchpadDocument,
  input: { id: string; path?: string; revision: string },
): void {
  assertScratchpadIdentity(current, input);
  if (input.revision !== current.revision)
    throw new Error(
      "This scratchpad changed after it was opened. Reload it before saving.",
    );
}

function assertScratchpadIdentity(
  current: ScratchpadDocument,
  input: { id: string; path?: string },
): void {
  if (current.id !== input.id || (input.path && current.path !== input.path))
    throw new Error("This scratchpad changed. Reload it before saving.");
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
