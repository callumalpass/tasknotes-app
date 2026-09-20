import { compareTasks, matchesArchiveFilter } from "../domain/task-query";
import type { Task, TaskListQuery } from "../domain/task";

type Entry = { task: Task };

/** Session-only indexes over repository-owned tasks; never a durable replica. */
export class ConnectedTaskIndex<Value extends Entry> extends Map<
  string,
  Value
> {
  private readonly paths = new Map<string, string>();
  private readonly rolling = new Map<string, Task>();
  private ordered?: Task[];
  private readonly searchMetadata = new WeakMap<Task, string>();
  private readonly trackers = new Set<Set<string>>();

  constructor() {
    // Map(entries) calls the override before subclass indexes exist.
    super();
  }

  override set(id: string, value: Value): this {
    const previous = this.get(id);
    if (previous === value) return this;
    if (previous) this.paths.delete(previous.task.path);
    this.paths.set(value.task.path, id);
    if (
      value.task.recurrence &&
      value.task.occurrenceMaterialization === "rolling"
    )
      this.rolling.set(id, value.task);
    else this.rolling.delete(id);
    for (const paths of this.trackers) {
      if (previous) paths.add(previous.task.path);
      paths.add(value.task.path);
    }
    if (previous?.task !== value.task) this.ordered = undefined;
    return super.set(id, value);
  }

  override delete(id: string): boolean {
    const previous = this.get(id);
    if (!previous) return false;
    this.paths.delete(previous.task.path);
    this.rolling.delete(id);
    for (const paths of this.trackers) paths.add(previous.task.path);
    this.ordered = undefined;
    return super.delete(id);
  }

  override clear(): void {
    for (const id of this.keys()) this.delete(id);
  }

  atPath(path: string): Value | undefined {
    const id = this.paths.get(path);
    return id === undefined ? undefined : this.get(id);
  }

  rollingParents(): Task[] {
    return [...this.rolling.values()];
  }

  /** Protect accepted local writes while a remote snapshot is being fetched. */
  trackWrites(): { paths: Set<string>; stop(): void } {
    const paths = new Set<string>();
    this.trackers.add(paths);
    return { paths, stop: () => this.trackers.delete(paths) };
  }

  list(query: TaskListQuery = {}): Task[] {
    const limit = query.limit ?? 500;
    if (limit === 0) return [];
    this.ordered ??= [...this.values()]
      .map(({ task }) => task)
      .sort(compareTasks);
    const tokens = (query.search ?? "")
      .trim()
      .toLocaleLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    const results: Task[] = [];
    for (const task of this.ordered) {
      if (!matchesArchiveFilter(task, query)) continue;
      if (query.status === "completed" && !task.completed) continue;
      if (
        query.status !== "completed" &&
        query.status !== "all" &&
        task.completed
      )
        continue;
      if (tokens.length) {
        let text = this.searchMetadata.get(task);
        if (text === undefined) {
          text = [
            task.title,
            ...task.tags,
            ...task.contexts,
            ...task.projects,
            ...task.attachments,
          ]
            .join("\n")
            .toLocaleLowerCase();
          this.searchMetadata.set(task, text);
        }
        const bodyTokens = tokens.filter((token) => !text.includes(token));
        if (bodyTokens.length) {
          // Do not retain a second normalized copy of every note body. Search
          // metadata first; normalize the body only when it could affect a match.
          const body = task.body.toLocaleLowerCase();
          if (!bodyTokens.every((token) => body.includes(token))) continue;
        }
      }
      results.push(task);
      if (limit > 0 && results.length >= limit) break;
    }
    // Preserve Array.slice limit semantics, including negative/fractional limits.
    return results.slice(0, limit);
  }
}
