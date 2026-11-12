/**
 * The calendar engine renders imperatively, so the hooks around it watch its
 * markup for changes and add nodes of their own. Each must tell the others'
 * additions from the engine's, or two of them answer each other forever.
 */

/** The "+3 more" button a bounded preview adds. */
export const PREVIEW_MORE_CLASS = "tnc-preview-more";
/** The hidden count a phone month measures its dots against. */
export const MONTH_MEASURE_CLASS = "tnc-month-measure";

/** Whether every node these mutations added or removed carries the class. */
export function onlyTouched(
  records: MutationRecord[],
  className: string,
): boolean {
  return records.every((record) =>
    [...record.addedNodes, ...record.removedNodes].every(
      (node) => node instanceof Element && node.classList.contains(className),
    ),
  );
}
