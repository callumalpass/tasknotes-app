import {
  outlineDisplayOffset,
  outlineSourceOffset,
} from "../domain/outline-references";

export function outlineSelection(input: HTMLTextAreaElement): number {
  return input.dataset.outlineSource
    ? outlineSourceOffset(input.dataset.outlineSource, input.selectionStart)
    : input.selectionStart;
}

export function setOutlineSelection(
  input: HTMLTextAreaElement,
  start: number,
  end = start,
  direction?: "forward" | "backward" | "none",
) {
  const source = input.dataset.outlineSource;
  input.setSelectionRange(
    source ? outlineDisplayOffset(source, start) : start,
    source ? outlineDisplayOffset(source, end) : end,
    direction,
  );
}
