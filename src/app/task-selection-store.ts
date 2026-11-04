import type { TaskSummary } from "../domain/task";

/** Selection is UI state. Reading order comes from data, including unmounted rows. */
export class TaskSelectionStore {
  private lists = new Map<object, readonly TaskSummary[]>();
  private listeners = new Set<() => void>();
  private selected = new Set<string>();
  private anchor: string | null = null;
  private version = 0;
  mode = false;
  explicit = false;
  busy = false;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.version;
  isSelected = (id: string) => this.selected.has(id);
  get tasks(): TaskSummary[] {
    return [
      ...new Map(
        [...this.lists.values()].flatMap((tasks) =>
          tasks.map((task) => [task.id, task] as const),
        ),
      ).values(),
    ];
  }
  get ids(): string[] {
    return this.tasks.map((task) => task.id);
  }
  get selectedTasks(): TaskSummary[] {
    return this.tasks.filter((task) => this.selected.has(task.id));
  }
  get count(): number {
    return this.selected.size;
  }

  register(owner: object, tasks: readonly TaskSummary[]) {
    const before = this.ids.join("\0");
    const revisions = new Map(
      this.selectedTasks.map((task) => [task.id, task.revision]),
    );
    this.lists.set(owner, tasks);
    const ids = new Set(this.ids);
    const removed = [...this.selected].some((id) => !ids.has(id));
    this.selected = new Set([...this.selected].filter((id) => ids.has(id)));
    if (this.anchor && !ids.has(this.anchor)) this.anchor = null;
    if (
      removed ||
      before !== this.ids.join("\0") ||
      this.selectedTasks.some(
        (task) => revisions.get(task.id) !== task.revision,
      )
    )
      this.publish();
  }
  unregister(owner: object) {
    this.register(owner, []);
    this.lists.delete(owner);
  }
  enter() {
    this.explicit = true;
    this.mode = true;
    this.publish();
  }
  clear = () => {
    this.selected.clear();
    this.anchor = null;
    this.mode = false;
    this.explicit = false;
    this.publish();
  };
  toggle(id: string) {
    if (this.busy || !this.ids.includes(id)) return;
    this.mode = true;
    if (this.selected.has(id)) this.selected.delete(id);
    else this.selected.add(id);
    this.anchor = id;
    this.publish();
  }
  range(id: string, from?: string) {
    if (this.busy) return;
    const ids = this.ids;
    const start = ids.indexOf(this.anchor ?? from ?? id),
      end = ids.indexOf(id);
    if (start < 0 || end < 0) return;
    this.anchor ??= from ?? id;
    this.mode = true;
    this.selected = new Set(
      ids.slice(Math.min(start, end), Math.max(start, end) + 1),
    );
    this.publish();
  }
  all() {
    if (this.busy) return;
    this.mode = true;
    this.selected = new Set(this.ids);
    this.anchor ??= this.ids[0] ?? null;
    this.publish();
  }
  remove(ids: readonly string[]) {
    for (const id of ids) this.selected.delete(id);
    if (!this.selected.size) {
      this.mode = false;
      this.explicit = false;
    }
    this.publish();
  }
  setBusy(value: boolean) {
    this.busy = value;
    this.publish();
  }
  private publish() {
    this.version++;
    for (const listener of this.listeners) listener();
  }
}
