/** Session-only weighted LRU. An oversized value is omitted, never truncated. */
export class BoundedCache<Value> {
  private readonly entries = new Map<string, { value: Value; bytes: number }>();
  private bytes = 0;

  constructor(
    private readonly maxEntries: number,
    private readonly maxBytes: number,
    private readonly measure: (value: Value) => number,
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
    const bytes = this.measure(value);
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

  keys(): IterableIterator<string> {
    return this.entries.keys();
  }

  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }
}
