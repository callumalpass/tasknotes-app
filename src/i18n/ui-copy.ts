import { t } from "@lingui/core/macro";

/** Lazy source-owned UI fragments. Never pass record data or identifiers here.
 * Lingui's native transform does not recursively compile macros inside another
 * t template's interpolation. Resolve these fragments outside that macro AST.
 */
export function uiCopy(
  key:
    | "options"
    | "move"
    | "reorder"
    | "This section"
    | "this view"
    | "Tap to retry."
    | "selected collection"
    | "up"
    | "down"
    | ", now Home"
    | "That section"
    | "selected day"
    | "session"
    | "from"
    | "to"
    | "before"
    | "after"
    | "Previous note"
    | "current scratchpad"
    | "scratchpad"
    | "Expand"
    | "Collapse"
    | "item"
    | "empty item"
    | "empty task"
    | "the destination section",
): string {
  switch (key) {
    case "options":
      return t`options`;
    case "move":
      return t`move`;
    case "reorder":
      return t`reorder`;
    case "This section":
      return t`This section`;
    case "this view":
      return t`this view`;
    case "Tap to retry.":
      return t`Tap to retry.`;
    case "selected collection":
      return t`selected collection`;
    case "up":
      return t`up`;
    case "down":
      return t`down`;
    case ", now Home":
      return t`, now Home`;
    case "That section":
      return t`That section`;
    case "selected day":
      return t`selected day`;
    case "session":
      return t`session`;
    case "from":
      return t`from`;
    case "to":
      return t`to`;
    case "before":
      return t`before`;
    case "after":
      return t`after`;
    case "Previous note":
      return t`Previous note`;
    case "current scratchpad":
      return t`current scratchpad`;
    case "scratchpad":
      return t`scratchpad`;
    case "Expand":
      return t`Expand`;
    case "Collapse":
      return t`Collapse`;
    case "item":
      return t`item`;
    case "empty item":
      return t`empty item`;
    case "empty task":
      return t`empty task`;
    case "the destination section":
      return t`the destination section`;
  }
}
