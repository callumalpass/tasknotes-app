import type { NlpTriggerConfig } from "@tasknotes/model/types";
import type { CreateTaskInput } from "./task";

/** A phrase in the capture text that the parser consumed into a field. */
export interface CaptureHighlight {
  start: number;
  end: number;
  /** Set when the phrase begins with a configured trigger such as `#`. */
  propertyId?: string;
  /** The trigger value without its trigger, link brackets, or punctuation. */
  value?: string;
}

interface Word {
  text: string;
  start: number;
}

interface Fragment {
  start: number;
  end: number;
}

// A wikilink keeps its spaces inside one word so `+[[Big project]]` stays whole.
const WORD = /\S*?\[\[[^\]]*\]\]\S*|\S+/gu;

/**
 * The parser returns field values and the remaining title, not source offsets.
 * Recognized phrases are therefore the parts of `text` that the title no longer
 * contains: words are aligned first so letters inside a consumed phrase never
 * pair with a later title word, then leftover title fragments such as the
 * comma in `#work,` are located within the unmatched words of the same gap.
 */
export function recognizedCaptureSpans(
  text: string,
  title: string,
  triggers: readonly NlpTriggerConfig[],
): CaptureHighlight[] {
  const input = words(text);
  if (!input.length) return [];
  const remaining = words(title);
  const pairs = alignWords(input, remaining);
  const fragments: Fragment[] = [];
  let inputIndex = 0;
  let titleIndex = 0;
  for (const [matchedInput, matchedTitle] of [
    ...pairs,
    [input.length, remaining.length] as const,
  ]) {
    fragments.push(
      ...gapFragments(
        input.slice(inputIndex, matchedInput),
        remaining.slice(titleIndex, matchedTitle),
      ),
    );
    inputIndex = matchedInput + 1;
    titleIndex = matchedTitle + 1;
  }
  const ordered = [...triggers].sort(
    (left, right) => right.trigger.length - left.trigger.length,
  );
  const highlights: CaptureHighlight[] = [];
  for (const fragment of fragments) {
    const phrase = text.slice(fragment.start, fragment.end);
    const trigger = ordered.find((entry) => phrase.startsWith(entry.trigger));
    if (trigger) {
      const value = triggerValue(phrase.slice(trigger.trigger.length));
      if (!value) continue;
      highlights.push({
        ...fragment,
        propertyId: trigger.propertyId,
        value,
      });
      continue;
    }
    // Lone quotes or punctuation are syntax, not something the parser read.
    if (!/[\p{L}\p{N}]/u.test(phrase)) continue;
    const previous = highlights.at(-1);
    if (
      previous &&
      !previous.propertyId &&
      /^\s+$/u.test(text.slice(previous.end, fragment.start))
    ) {
      previous.end = fragment.end;
      continue;
    }
    highlights.push({ ...fragment });
  }
  return highlights;
}

/**
 * Drops phrases whose field no longer holds the parsed value, such as a tag
 * removed from the interpretation row while its text is still typed.
 */
export function reflectedCaptureHighlights(
  highlights: readonly CaptureHighlight[],
  input: CreateTaskInput,
): CaptureHighlight[] {
  const timed = Boolean(
    input.scheduled || input.due || input.recurrence || input.timeEstimate,
  );
  return highlights.filter((highlight) => {
    if (!highlight.propertyId) return timed;
    const value = highlight.value?.toLocaleLowerCase();
    const holds = (values: readonly string[] | undefined) =>
      Boolean(
        values?.some(
          (candidate) => triggerValue(candidate).toLocaleLowerCase() === value,
        ),
      );
    if (highlight.propertyId === "tags") return holds(input.tags);
    if (highlight.propertyId === "contexts") return holds(input.contexts);
    if (highlight.propertyId === "projects") return holds(input.projects);
    if (highlight.propertyId === "status") return input.status !== undefined;
    if (highlight.propertyId === "priority")
      return input.priority !== undefined;
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
    if (!standsAlone(start, end)) {
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

function words(text: string): Word[] {
  return [...text.matchAll(WORD)].map((match) => ({
    text: match[0],
    start: match.index,
  }));
}

/** Longest common word subsequence, as ascending index pairs. */
function alignWords(input: Word[], title: Word[]): [number, number][] {
  const rows = input.length + 1;
  const columns = title.length + 1;
  const lengths = new Uint16Array(rows * columns);
  for (let i = input.length - 1; i >= 0; i--)
    for (let j = title.length - 1; j >= 0; j--)
      lengths[i * columns + j] =
        input[i].text === title[j].text
          ? lengths[(i + 1) * columns + j + 1] + 1
          : Math.max(
              lengths[(i + 1) * columns + j],
              lengths[i * columns + j + 1],
            );
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < input.length && j < title.length) {
    if (input[i].text === title[j].text) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (lengths[(i + 1) * columns + j] >= lengths[i * columns + j + 1])
      i++;
    else j++;
  }
  return pairs;
}

function gapFragments(input: Word[], title: Word[]): Fragment[] {
  const fragments: Fragment[] = [];
  let titleIndex = 0;
  for (const word of input) {
    const end = word.start + word.text.length;
    const kept = title[titleIndex]
      ? word.text.indexOf(title[titleIndex].text)
      : -1;
    if (kept < 0) {
      fragments.push({ start: word.start, end });
      continue;
    }
    const keptEnd = kept + title[titleIndex].text.length;
    titleIndex++;
    if (kept > 0) fragments.push({ start: word.start, end: word.start + kept });
    if (keptEnd < word.text.length)
      fragments.push({ start: word.start + keptEnd, end });
  }
  return fragments;
}

function triggerValue(value: string): string {
  return value
    .replace(/[.,;:!?)]+$/u, "")
    .replace(/^\[\[|\]\]$/gu, "")
    .trim();
}
