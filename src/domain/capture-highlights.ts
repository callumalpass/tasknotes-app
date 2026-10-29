import type { ParsedSpan } from "tasknotes-nlp-core";
import type { NlpTriggerConfig } from "@tasknotes/model/types";
import type { CreateTaskInput } from "./task";

/** A phrase in the capture text that the parser read into a field. */
export interface CaptureHighlight {
  start: number;
  end: number;
  kind: ParsedSpan["kind"];
  /** Set when the phrase begins with a configured trigger such as `#`. */
  propertyId?: string;
  /** The trigger value without its trigger, link brackets, or punctuation. */
  value?: string;
}

const triggerProperties: Partial<Record<ParsedSpan["kind"], string>> = {
  tag: "tags",
  context: "contexts",
  project: "projects",
  status: "status",
  priority: "priority",
};

/** Highlights for the spans the parser reported, with trigger values. */
export function captureHighlightsFromSpans(
  spans: readonly ParsedSpan[],
  triggers: readonly NlpTriggerConfig[],
): CaptureHighlight[] {
  return spans.map((span) => {
    const propertyId =
      span.kind === "field" ? span.field : triggerProperties[span.kind];
    const highlight: CaptureHighlight = {
      start: span.start,
      end: span.end,
      kind: span.kind,
    };
    if (!propertyId) return highlight;
    const trigger = triggers.find(
      (entry) =>
        entry.propertyId === propertyId && span.text.startsWith(entry.trigger),
    );
    return {
      ...highlight,
      propertyId,
      value: triggerValue(span.text.slice(trigger?.trigger.length ?? 0)),
    };
  });
}

/**
 * Drops phrases whose field no longer holds the parsed value, such as a tag
 * removed from the interpretation row while its text is still typed.
 */
export function reflectedCaptureHighlights(
  highlights: readonly CaptureHighlight[],
  input: CreateTaskInput,
): CaptureHighlight[] {
  return highlights.filter((highlight) => {
    const value = highlight.value?.toLocaleLowerCase();
    const holds = (values: readonly string[] | undefined) =>
      Boolean(
        values?.some(
          (candidate) => triggerValue(candidate).toLocaleLowerCase() === value,
        ),
      );
    switch (highlight.kind) {
      case "scheduled":
        return input.scheduled !== undefined;
      case "due":
        return input.due !== undefined;
      case "recurrence":
        return input.recurrence !== undefined;
      case "estimate":
        return input.timeEstimate !== undefined;
      case "tag":
        return holds(input.tags);
      case "context":
        return holds(input.contexts);
      case "project":
        return holds(input.projects);
      case "status":
        return input.status !== undefined;
      case "priority":
        return input.priority !== undefined;
    }
    return true;
  });
}

/**
 * Maps phrases from the settled parse onto the current, possibly edited, input
 * value until the next parse settles. A phrase survives only while its text
 * still stands at the same place, so typing ahead keeps earlier highlights
 * steady. Two edits at a phrase's end degrade gently rather than blinking: a
 * trigger word that keeps growing (`#wo` → `#wor`) stretches over the word, and
 * a phrase whose last word changed (`tomorrow at 3` → `tomorrow at 3p`) falls
 * back to its intact leading words.
 */
export function currentCaptureHighlights(
  highlights: readonly CaptureHighlight[],
  parsedText: string,
  text: string,
): CaptureHighlight[] {
  const offset = text.length - text.trimStart().length;
  const current = text.slice(offset);
  const standsAlone = (start: number, end: number) =>
    (start === 0 || /\s/u.test(current[start - 1] ?? "")) &&
    (end >= current.length || /\s/u.test(current[end]));
  return highlights.flatMap((highlight) => {
    const { start } = highlight;
    let { end } = highlight;
    if (current.slice(start, end) !== parsedText.slice(start, end)) return [];
    // Unchanged on both sides, as in `tomorrow,` or text without spaces.
    const around = (value: string) =>
      value.slice(Math.max(start - 1, 0), end + 1);
    if (around(current) !== around(parsedText) && !standsAlone(start, end)) {
      if (start > 0 && !/\s/u.test(current[start - 1] ?? "")) return [];
      if (highlight.propertyId) {
        while (end < current.length && !/\s/u.test(current[end])) end++;
      } else {
        const phrase = current.slice(start, end);
        const lastSpace = phrase.search(/\s+\S*$/u);
        if (lastSpace <= 0) return [];
        end = start + lastSpace;
      }
    }
    return [{ ...highlight, start: start + offset, end: end + offset }];
  });
}

function triggerValue(value: string): string {
  return value
    .replace(/[.,;:!?)]+$/u, "")
    .replace(/^\[\[|\]\]$/gu, "")
    .trim();
}
