import { linkDisplayLabel } from "./completion";

export function outlineReferences(source: string) {
  let display = "";
  let offset = 0;
  const references = [...source.matchAll(/\[\[[^\]\n]+\]\]/g)].map((match) => {
    display += source.slice(offset, match.index);
    const from = display.length;
    display += linkDisplayLabel(match[0]);
    offset = match.index + match[0].length;
    return {
      from,
      to: display.length,
      sourceFrom: match.index,
      sourceTo: offset,
    };
  });
  display += source.slice(offset);
  return { display, references };
}

export function outlineSourceOffset(
  source: string,
  offset: number,
  end = false,
): number {
  let difference = 0;
  for (const reference of outlineReferences(source).references) {
    if (offset <= reference.from) break;
    if (offset < reference.to)
      return end ? reference.sourceTo : reference.sourceFrom;
    difference +=
      reference.sourceTo -
      reference.sourceFrom -
      (reference.to - reference.from);
  }
  return offset + difference;
}

export function outlineDisplayOffset(source: string, offset: number): number {
  let difference = 0;
  for (const reference of outlineReferences(source).references) {
    if (offset <= reference.sourceFrom) break;
    if (offset < reference.sourceTo) return reference.to;
    difference +=
      reference.sourceTo -
      reference.sourceFrom -
      (reference.to - reference.from);
  }
  return offset - difference;
}

export function editOutlineDisplay(source: string, next: string) {
  const previous = outlineReferences(source).display;
  let from = 0;
  while (
    from < previous.length &&
    from < next.length &&
    previous[from] === next[from]
  )
    from++;
  let tail = 0;
  while (
    tail < previous.length - from &&
    tail < next.length - from &&
    previous[previous.length - tail - 1] === next[next.length - tail - 1]
  )
    tail++;
  const insertion = previous.length === from + tail;
  const sourceFrom = outlineSourceOffset(source, from, insertion);
  const sourceTo = outlineSourceOffset(source, previous.length - tail, true);
  const inserted = next.slice(from, next.length - tail);
  return {
    text: source.slice(0, sourceFrom) + inserted + source.slice(sourceTo),
    cursor: sourceFrom + inserted.length,
  };
}
