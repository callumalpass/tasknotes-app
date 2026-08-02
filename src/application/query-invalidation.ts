export type QueryScope =
  | `task:${string}`
  | `tasks:${string}`
  | `relationships:${string}`
  | `view:${string}`
  | "collection-summary";

/** Query-scoped revisions keep repository writes out of global React state. */
export class QueryInvalidationStore {
  private readonly revisions = new Map<QueryScope, number>();
  private readonly listeners = new Map<QueryScope, Set<() => void>>();

  revision(scope: QueryScope): number {
    return this.revisions.get(scope) ?? 0;
  }

  subscribe(scope: QueryScope, listener: () => void): () => void {
    const listeners = this.listeners.get(scope) ?? new Set();
    listeners.add(listener);
    this.listeners.set(scope, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(scope);
    };
  }

  invalidate(scopes: Iterable<QueryScope>): void {
    for (const scope of new Set(scopes)) this.publish(scope);
  }

  invalidateAll(): void {
    for (const scope of this.listeners.keys()) this.publish(scope);
  }

  invalidateTasks(taskIds: Iterable<string>): void {
    const scopes: QueryScope[] = ["collection-summary"];
    for (const id of new Set(taskIds))
      scopes.push(`task:${id}`, `relationships:${id}`);
    for (const scope of this.listeners.keys())
      if (scope.startsWith("tasks:") || scope.startsWith("view:"))
        scopes.push(scope);
    this.invalidate(scopes);
  }

  private publish(scope: QueryScope): void {
    this.revisions.set(scope, this.revision(scope) + 1);
    for (const listener of this.listeners.get(scope) ?? []) listener();
  }
}
