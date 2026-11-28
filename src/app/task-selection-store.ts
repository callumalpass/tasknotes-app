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
  private byId = new Map<string, { task: TaskSummary; index: number }>();
  private order: string[] = [];
  private selectedSnapshot?: TaskSummary[];
  get tasks(): TaskSummary[] {
    return Array.from(this.byId.values(), (row) => row.task);
  }
  get ids(): readonly string[] {
    return this.order;
  }
  get selectedTasks(): readonly TaskSummary[] {
    return (this.selectedSnapshot ??= [...this.selected]
      .map((id) => this.byId.get(id)!)
      .sort((left, right) => left.index - right.index)
      .map((row) => row.task));
  }
  get count(): number {
    return this.selected.size;
  }

  register(owner: object, tasks: readonly TaskSummary[]) {
    if (tasks === this.lists.get(owner)) return;
    const previous = this.byId;
    const previousOrder = this.order;
    this.lists.set(owner, tasks);
    this.byId = new Map();
    for (const list of this.lists.values())
      for (const task of list)
        this.byId.set(task.id, {
          task,
          index: this.byId.get(task.id)?.index ?? this.byId.size,
        });
    this.order = [...this.byId.keys()];
    this.selectedSnapshot = undefined;
    let selectionChanged = false;
    for (const id of this.selected) {
      const row = this.byId.get(id);
      if (!row) this.selected.delete(id);
      if (!row || row.task.revision !== previous.get(id)?.task.revision)
        selectionChanged = true;
    }
    if (this.anchor && !this.byId.has(this.anchor)) this.anchor = null;
    if (
      selectionChanged ||
      previousOrder.length !== this.order.length ||
      previousOrder.some((id, index) => id !== this.order[index])
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
    if (this.busy || !this.byId.has(id)) return;
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
    this.selectedSnapshot = undefined;
    this.version++;
    for (const listener of this.listeners) listener();
  }
}
