import type { CollectionChange } from "@mdbase-dev/connect";

/** Unknown/resource/schema events require a new authoritative task snapshot. */
export function changedRecordPaths(
  events: readonly CollectionChange[],
): Set<string> | null {
  const paths = new Set<string>();
  for (const event of events) {
    switch (event.kind) {
      case "view.changed":
        break;
      case "record.renamed":
        paths.add(event.from);
        paths.add(event.to);
        break;
      case "record.created":
      case "record.updated":
      case "record.deleted":
        paths.add(event.path);
        break;
      default:
        return null;
    }
  }
  return paths;
}
