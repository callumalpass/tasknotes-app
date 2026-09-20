import type { CollectionChange } from "@mdbase-dev/connect";

/** Unknown/resource/schema events require a new authoritative task snapshot. */
export function changedRecordPaths(
  events: readonly CollectionChange[],
): Set<string> | null {
  const paths = new Set<string>();
  for (const event of events) {
    if (event.type === "mdbase.view.changed") continue;
    if (event.type === "mdbase.record.renamed") {
      if (
        typeof event.payload.from !== "string" ||
        typeof event.payload.to !== "string"
      )
        return null;
      paths.add(event.payload.from);
      paths.add(event.payload.to);
    } else if (
      [
        "mdbase.record.created",
        "mdbase.record.modified",
        "mdbase.record.deleted",
      ].includes(event.type)
    ) {
      if (typeof event.payload.path !== "string") return null;
      paths.add(event.payload.path);
    } else return null;
  }
  return paths;
}
