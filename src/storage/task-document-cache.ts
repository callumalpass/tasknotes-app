import type { Task } from "../domain/task";
import { BoundedCache } from "./bounded-cache";

/** Bounded session-only documents; summaries live separately and never own bodies. */
export class TaskDocumentCache<
  Value extends { task: Task },
> extends BoundedCache<Value> {
  constructor(maxEntries = 64, maxBytes = 8 * 1024 * 1024) {
    super(
      maxEntries,
      maxBytes,
      (value) =>
        // Conservative UTF-16 text budget, independent of engine string compression.
        2 *
        (value.task.body.length +
          JSON.stringify(value.task.frontmatter).length),
    );
  }
}
