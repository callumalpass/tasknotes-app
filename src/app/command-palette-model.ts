import { t } from "@lingui/core/macro";
export type PaletteSection = "task" | "navigate" | "actions" | "tasks";

export interface PaletteCommand {
  id: string;
  label: string;
  section: PaletteSection;
  /** Extra words that should match, such as "settings" for "Preferences". */
  keywords?: string[];
  /** Key hint shown beside the command, such as "x". */
  shortcut?: string;
  detail?: string;
  run(): void;
}

export const paletteSectionLabels: Record<PaletteSection, string> = {
  get task() {
    return t({ message: "Focused task" });
  },
  get navigate() {
    return t({ message: "Go to" });
  },
  get actions() {
    return t({ message: "Actions" });
  },
  get tasks() {
    return t({ message: "Tasks" });
  },
};

const sectionOrder: PaletteSection[] = ["task", "navigate", "actions", "tasks"];

/**
 * Score a fuzzy subsequence match: every query character must appear in
 * order. Word starts, a matching prefix, and runs of adjacent characters
 * rank higher. Returns null when the text does not match.
 */
export function fuzzyScore(text: string, query: string): number | null {
  const haystack = text.toLocaleLowerCase();
  const needle = query.trim().toLocaleLowerCase().replace(/\s+/g, " ");
  if (!needle) return 0;
  const contiguous = haystack.indexOf(needle);
  if (contiguous >= 0)
    return (
      1000 -
      contiguous +
      (contiguous === 0 || /\W/.test(haystack[contiguous - 1]) ? 200 : 0)
    );
  let score = 0;
  let position = -1;
  let run = 0;
  for (const character of needle) {
    if (character === " ") continue;
    const index = haystack.indexOf(character, position + 1);
    if (index < 0) return null;
    const wordStart = index === 0 || /\W/.test(haystack[index - 1]);
    run = index === position + 1 ? run + 1 : 0;
    score +=
      10 + run * 5 + (wordStart ? 15 : 0) - Math.min(index - position, 10);
    position = index;
  }
  return score;
}

/** Filter and order commands for a query, keeping each section together. */
export function rankCommands(
  commands: readonly PaletteCommand[],
  query: string,
): PaletteCommand[] {
  const scored = commands.flatMap((command, index) => {
    const score = Math.max(
      ...[command.label, ...(command.keywords ?? [])].map(
        (text) => fuzzyScore(text, query) ?? -Infinity,
      ),
    );
    return score === -Infinity ? [] : [{ command, score, index }];
  });
  const searching = query.trim().length > 0;
  // While searching, the section with the strongest match leads, so "new"
  // selects New task rather than a loose match such as "maNagE vieWs".
  const best = new Map<PaletteSection, number>();
  for (const { command, score } of scored)
    best.set(
      command.section,
      Math.max(best.get(command.section) ?? -Infinity, score),
    );
  const sectionRank = (section: PaletteSection) =>
    searching ? -best.get(section)! : sectionOrder.indexOf(section);
  return scored
    .sort(
      (a, b) =>
        sectionRank(a.command.section) - sectionRank(b.command.section) ||
        sectionOrder.indexOf(a.command.section) -
          sectionOrder.indexOf(b.command.section) ||
        (searching ? b.score - a.score : 0) ||
        a.index - b.index,
    )
    .map(({ command }) => command);
}
