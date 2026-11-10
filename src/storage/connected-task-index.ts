import { todayString } from "../domain/task";
import {
  todayTaskContribution,
  type TodayTaskCounts,
} from "../domain/today-summary";
import {
  compareTasks,
  selectTaskSummaries,
  taskSearchMetadata,
} from "../domain/task-query";
import {
  taskRowRelations,
  type TaskRowRelations,
} from "../domain/task-row-relations";
import type { TaskSummary, TaskListQuery } from "../domain/task";

type Entry = { task: TaskSummary };

/** Session-only indexes over repository-owned tasks; never a durable replica. */
export class ConnectedTaskIndex<Value extends Entry> extends Map<
  string,
  Value
> {
  private readonly paths = new Map<string, string>();
  private readonly rolling = new Map<string, TaskSummary>();
  private ordered?: TaskSummary[];
  private relations?: TaskRowRelations;
  private readonly searchMetadata = new WeakMap<TaskSummary, string>();
  private readonly trackers = new Set<Set<string>>();

  private countDay = todayString();
  private counts: TodayTaskCounts = { total: 0, overdue: 0 };

  /** No queries or sorting; changes adjust two counters. Rollover scans metadata once. */
  todayCounts(today: string): TodayTaskCounts {
    if (today !== this.countDay) {
      this.countDay = today;
      this.counts = { total: 0, overdue: 0 };
      for (const { task } of this.values()) this.adjustCounts(task, 1);
    }
    return { ...this.counts };
  }

  private adjustCounts(task: TaskSummary, direction: 1 | -1) {
    const contribution = todayTaskContribution(task, this.countDay);
    this.counts.total += direction * contribution.total;
    this.counts.overdue += direction * contribution.overdue;
  }

  constructor() {
    // Map(entries) calls the override before subclass indexes exist.
    super();
  }

  override set(id: string, value: Value): this {
    const previous = this.get(id);
    if (previous === value) return this;
    if (previous) {
      this.paths.delete(previous.task.path);
      this.adjustCounts(previous.task, -1);
    }
    this.adjustCounts(value.task, 1);
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
    if (previous?.task !== value.task) {
      this.ordered = undefined;
      this.relations = undefined;
    }
    return super.set(id, value);
  }

  override delete(id: string): boolean {
    const previous = this.get(id);
    if (!previous) return false;
    this.paths.delete(previous.task.path);
    this.adjustCounts(previous.task, -1);
    this.rolling.delete(id);
    for (const paths of this.trackers) paths.add(previous.task.path);
    this.ordered = undefined;
    this.relations = undefined;
    return super.delete(id);
  }

  override clear(): void {
    for (const id of this.keys()) this.delete(id);
  }

  /** Subtask counts and open blockers; rebuilt only after metadata changes. */
  rowRelations(): TaskRowRelations {
    this.relations ??= taskRowRelations(
      (function* (entries: Iterable<Value>) {
        for (const { task } of entries) yield task;
      })(this.values()),
    );
    return this.relations;
  }

  atPath(path: string): Value | undefined {
    const id = this.paths.get(path);
    return id === undefined ? undefined : this.get(id);
  }

  rollingParents(): TaskSummary[] {
    return [...this.rolling.values()];
  }

  /** Protect accepted local writes while a remote snapshot is being fetched. */
  trackWrites(): { paths: Set<string>; stop(): void } {
    const paths = new Set<string>();
    this.trackers.add(paths);
    return { paths, stop: () => this.trackers.delete(paths) };
  }

  matchesMetadata(task: TaskSummary, token: string): boolean {
    let text = this.searchMetadata.get(task);
    if (text === undefined) {
      text = taskSearchMetadata(task);
      this.searchMetadata.set(task, text);
    }
    return text.includes(token);
  }

  list(
    query: TaskListQuery = {},
    bodyMatches?: (task: TaskSummary, token: string) => boolean,
    /** Restricts results to these paths, e.g. tasks mdbase resolved as assigned. */
    paths?: ReadonlySet<string>,
  ): TaskSummary[] {
    if (query.limit === 0) return [];
    this.ordered ??= [...this.values()]
      .map(({ task }) => task)
      .sort(compareTasks);
    return selectTaskSummaries(
      this.ordered,
      query,
      (task, token) =>
        this.matchesMetadata(task, token) ||
        Boolean(bodyMatches?.(task, token)),
      paths,
    );
  }
}
