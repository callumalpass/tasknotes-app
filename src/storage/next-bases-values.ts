import type { AppBasesCell } from "@mdbase-dev/sdk/app-host";

/** Retain native temporal/error/unavailable provenance. No JS date/duration
 * reconstruction or missing-tag invention. Primitive cells remain primitives. */
export function nativeCellValue(cell: AppBasesCell): unknown {
  switch (cell.kind) {
    case "null":
      return null;
    case "boolean":
    case "number":
    case "text":
      return cell.value;
    case "list":
      return cell.values.map(nativeCellValue);
    case "map":
      return Object.fromEntries(
        [...cell.values].map(([key, value]) => [key, nativeCellValue(value)]),
      );
    case "date":
    case "duration":
    case "error":
    case "unavailable":
      return structuredClone(cell);
  }
}
