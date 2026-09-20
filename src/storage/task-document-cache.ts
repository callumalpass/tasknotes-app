import type { Task } from "../domain/task";

/** Bounded session-only documents; summaries live separately and never own bodies. */
export class TaskDocumentCache<Value extends { task: Task }> {
  private readonly entries = new Map<string, { value: Value; bytes: number }>();
  private bytes = 0;

  constructor(
    private readonly maxEntries = 64,
    private readonly maxBytes = 8 * 1024 * 1024,
  ) {}

  get(id: string): Value | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    this.entries.delete(id);
    this.entries.set(id, entry);
    return entry.value;
  }

  set(id: string, value: Value): void {
    this.delete(id);
    // Conservative UTF-16 text budget, independent of engine string compression.
    const bytes =
      2 *
      (value.task.body.length + JSON.stringify(value.task.frontmatter).length);
    if (bytes > this.maxBytes) return;
    this.entries.set(id, { value, bytes });
    this.bytes += bytes;
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes)
      this.delete(this.entries.keys().next().value!);
  }

  delete(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.bytes -= entry.bytes;
    this.entries.delete(id);
  }

  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }
}
