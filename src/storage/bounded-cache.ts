import type { TaskViewExecution } from "../domain/view";

/** Session-only weighted LRU. An oversized value is omitted, never truncated. */
export class BoundedCache<Value> {
  private readonly entries = new Map<string, { value: Value; bytes: number }>();
  private bytes = 0;

  constructor(
    private readonly maxEntries: number,
    private readonly maxBytes: number,
    private readonly measure: (value: Value, budget: number) => number,
  ) {}

  get(id: string): Value | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    this.entries.delete(id);
    this.entries.set(id, entry);
    return entry.value;
  }

  set(id: string, value: Value): boolean {
    this.delete(id);
    const bytes = this.measure(value, this.maxBytes);
    if (bytes > this.maxBytes) return false;
    this.entries.set(id, { value, bytes });
    this.bytes += bytes;
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes)
      this.delete(this.entries.keys().next().value!);
    return true;
  }

  delete(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.bytes -= entry.bytes;
    this.entries.delete(id);
  }

  keys(): IterableIterator<string> {
    return this.entries.keys();
  }

  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }
}

/** Same UTF-16 JSON weight as a full serialization. Stop once admission
 * is impossible rather than allocating a giant temporary string. */
export function viewExecutionBytes(
  execution: TaskViewExecution,
  budget: number,
) {
  const { rows, ...header } = execution;
  let bytes = JSON.stringify({ ...header, rows: [] }).length * 2;
  for (let offset = 0; offset < rows.length && bytes <= budget; offset += 128) {
    const chunk = JSON.stringify(rows.slice(offset, offset + 128));
    bytes += 2 * (chunk.length - 2 + Number(offset > 0));
  }
  return bytes;
}
