import type { AppBasesCell } from "@mdbase-dev/sdk/app-host";
import { nativeCellValue } from "./next-bases-values";

/** Project actual native cells and group membership. A group property need not
 * be a display column. Its omitted row value comes ONLY from the native key
 * and native rowIndices, never JS grouping, defaults, field aliases or sorting.
 * An existing display cell retains its own native temporal/error provenance. */
export function nativeRowValues(
  columns: readonly string[],
  rows: readonly { cells: readonly AppBasesCell[] }[],
  groups: readonly { key: AppBasesCell; rowIndices: readonly number[] }[],
  groupProperty?: string,
): Record<string, unknown>[] {
  const values = rows.map((row) => {
    if (row.cells.length !== columns.length)
      throw new Error("Native row cells do not match their declared columns.");
    return Object.fromEntries(
      columns.map((column, index) => [
        column,
        nativeCellValue(row.cells[index]!),
      ]),
    );
  });
  if (!groups.length) {
    if (groupProperty !== undefined && rows.length)
      throw new Error("Native grouped execution omitted its row partition.");
    return values;
  }
  if (groupProperty === undefined)
    throw new Error("Native grouped execution omitted its group property.");
  const seen = new Uint8Array(rows.length);
  for (const group of groups) {
    for (const index of group.rowIndices) {
      if (
        !Number.isSafeInteger(index) ||
        index < 0 ||
        index >= rows.length ||
        seen[index]
      )
        throw new Error("Native group row partition is invalid.");
      seen[index] = 1;
      if (!Object.hasOwn(values[index]!, groupProperty))
        values[index] = {
          ...values[index],
          [groupProperty]: nativeCellValue(group.key),
        };
    }
  }
  if (seen.some((present) => present === 0))
    throw new Error("Native group row partition is incomplete.");
  return values;
}
