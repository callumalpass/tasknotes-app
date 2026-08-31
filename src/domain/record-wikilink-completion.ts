import { recordCompletion } from "./completion";

import type { FieldCompletion, FieldCompletionRequest } from "./completion";

export interface ActiveRecordWikilink {
  from: number;
  to: number;
  query: string;
}

export function activeRecordWikilink(
  text: string,
  cursor: number,
): ActiveRecordWikilink | undefined {
  const position = Math.max(0, Math.min(cursor, text.length));
  const lineStart = text.lastIndexOf("\n", position - 1) + 1;
  const lineEndValue = text.indexOf("\n", position);
  const lineEnd = lineEndValue < 0 ? text.length : lineEndValue;
  const beforeCursor = text.slice(lineStart, position);
  const relativeOpening = beforeCursor.lastIndexOf("[[");
  if (relativeOpening < 0) return;
  const opening = lineStart + relativeOpening;
  if (isEscaped(text, opening)) return;
  const query = text.slice(opening + 2, position);
  if (query.includes("]]") || query.includes("[[") || query.includes("|"))
    return;
  const closing = text.indexOf("]]", position);
  return {
    from: opening,
    to: closing >= 0 && closing < lineEnd ? closing + 2 : position,
    query: query.trim(),
  };
}

export function recordWikilinkCompletionRequest(
  token: ActiveRecordWikilink,
): FieldCompletionRequest {
  return {
    field: "wikilink",
    kind: "records",
    query: token.query,
    limit: 12,
  };
}

export function recordWikilinkValue(
  completion: FieldCompletion,
): string | undefined {
  if (completion.kind !== "record" || !completion.path) return;
  return recordCompletion(
    {
      path: completion.path,
      label: completion.label,
      frontmatter: {},
      types: [],
    },
    "wikilink",
  ).value;
}

export function applyRecordWikilinkCompletion(
  text: string,
  token: ActiveRecordWikilink,
  completion: FieldCompletion,
): { text: string; cursor: number } | undefined {
  const value = recordWikilinkValue(completion);
  if (!value) return;
  return {
    text: `${text.slice(0, token.from)}${value}${text.slice(token.to)}`,
    cursor: token.from + value.length,
  };
}

function isEscaped(value: string, index: number): boolean {
  let backslashes = 0;
  for (
    let cursor = index - 1;
    cursor >= 0 && value[cursor] === "\\";
    cursor -= 1
  )
    backslashes += 1;
  return backslashes % 2 === 1;
}
