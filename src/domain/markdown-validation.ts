const TEMPORARY_WIKILINK_GUARD_MESSAGE =
  "invalid_wikilink: Finish or remove the empty or incomplete wikilink before saving.";

type Fence = { marker: "`" | "~"; length: number };

/**
 * Temporary protection for mdbase-connect#359. Remove after the fix merged in
 * mdbase-connect#364 has been deployed to every supported collection authority.
 */
export function assertPersistableMarkdownWikilinks(markdown: string): void {
  for (const segment of markdownOutsideFences(markdown))
    assertPersistableSegmentWikilinks(segment);
}

function markdownOutsideFences(markdown: string): string[] {
  const segments: string[] = [""];
  let fence: Fence | undefined;

  for (const line of markdown.split(/\r?\n/)) {
    if (fence) {
      if (isClosingFence(line, fence)) {
        fence = undefined;
        segments.push("");
      }
      continue;
    }

    if (/^(?: {4}|\t)/.test(line)) {
      segments.push("");
      continue;
    }

    const opening = openingFence(line);
    if (opening) {
      fence = opening;
      segments.push("");
      continue;
    }

    const index = segments.length - 1;
    segments[index] = `${segments[index]}${segments[index] ? "\n" : ""}${line}`;
  }

  return segments;
}

function openingFence(line: string): Fence | undefined {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  const run = match?.[1];
  if (!run || (run[0] === "`" && match[2]?.includes("`"))) return;
  return { marker: run[0] as Fence["marker"], length: run.length };
}

function isClosingFence(line: string, fence: Fence): boolean {
  const run = /^ {0,3}(`{3,}|~{3,})[\t ]*$/.exec(line)?.[1];
  return run?.[0] === fence.marker && run.length >= fence.length;
}

function assertPersistableSegmentWikilinks(segment: string): void {
  let cursor = 0;
  while (cursor < segment.length) {
    if (segment[cursor] === "`") {
      const runEnd = repeatedMarkerEnd(segment, cursor, "`");
      const closing = closingBacktickRun(segment, runEnd, runEnd - cursor);
      if (closing >= 0) {
        cursor = closing + runEnd - cursor;
        continue;
      }
      cursor = runEnd;
      continue;
    }

    if (segment.startsWith("[[", cursor) && !isEscaped(segment, cursor)) {
      const closing = segment.indexOf("]]", cursor + 2);
      const lineEnd = segment.indexOf("\n", cursor + 2);
      if (closing < 0 || (lineEnd >= 0 && closing > lineEnd))
        throw new Error(TEMPORARY_WIKILINK_GUARD_MESSAGE);
      const value = segment.slice(cursor + 2, closing);
      const target = value.split("|", 1)[0]?.trim();
      if (!target || value.includes("[["))
        throw new Error(TEMPORARY_WIKILINK_GUARD_MESSAGE);
      cursor = closing + 2;
      continue;
    }
    cursor += 1;
  }
}

function closingBacktickRun(
  value: string,
  start: number,
  length: number,
): number {
  let cursor = start;
  while (cursor < value.length) {
    const candidate = value.indexOf("`", cursor);
    if (candidate < 0) return -1;
    const end = repeatedMarkerEnd(value, candidate, "`");
    if (end - candidate === length) return candidate;
    cursor = end;
  }
  return -1;
}

function repeatedMarkerEnd(
  value: string,
  start: number,
  marker: string,
): number {
  let end = start + 1;
  while (value[end] === marker) end += 1;
  return end;
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
