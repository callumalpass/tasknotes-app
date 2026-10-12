// Presentation stand-in only: no credentials, native endpoints or live data.
import { createRoot } from "react-dom/client";
import { AppShell } from "../src/app/app-shell";
import { CollectionGateContext } from "../src/app/collection-context";
import { RepositoryProvider } from "../src/app/repository-context";
import type {
  RecordWriteStatus,
  RecordWriteTarget,
  RepositoryChange,
  RepositoryConnectionStatus,
} from "../src/application/ports/task-repository";
import type { UpdateTaskInput } from "../src/domain/task";
import { todayString } from "../src/domain/task";
import { DemoTaskRepository } from "../src/demo/demo-task-repository";
import { DemoMutationJournal } from "../src/demo/demo-mutation-journal";
import "../src/styles.css";
import "../src/accessibility.css";

if (
  import.meta.env.MODE !== "e2e" ||
  !["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)
)
  throw new Error("Sync presentation fixture requires local e2e mode");
const phase = new URL(location.href).searchParams.get("phase") ?? "edit";
class FixtureRepository extends DemoTaskRepository {
  targetId = "";
  state: RecordWriteStatus | undefined;
  checks = 0;
  updates = 0;
  private fixtureListeners = new Set<(change?: RepositoryChange) => void>();
  private acknowledgement?: ReturnType<typeof setTimeout>;
  override subscribe(listener: (change?: RepositoryChange) => void) {
    const unsubscribe = super.subscribe(listener);
    this.fixtureListeners.add(listener);
    return () => {
      this.fixtureListeners.delete(listener);
      unsubscribe();
    };
  }
  writeState(target: RecordWriteTarget) {
    return target.kind === "task" && target.id === this.targetId
      ? this.state
      : undefined;
  }
  override async connectionStatus(): Promise<RepositoryConnectionStatus> {
    return {
      state: phase === "offline" ? "unavailable" : "connected",
      sync: {
        text: "Presentation fixture",
        pending: this.state === "pending" ? (phase === "offline" ? 3 : 1) : 0,
        held: 0,
      },
    };
  }
  private notify() {
    this.fixtureListeners.forEach((listener) => listener({ kind: "status" }));
  }
  setOutcome(state: RecordWriteStatus | undefined) {
    this.state = state;
    this.notify();
  }
  async reconcileWrites() {
    this.checks++;
    this.notify();
  }
  override async update(id: string, input: UpdateTaskInput) {
    this.updates++;
    this.targetId = id;
    this.setOutcome("pending");
    if (this.acknowledgement) clearTimeout(this.acknowledgement);
    if (phase === "edit")
      this.acknowledgement = setTimeout(
        () => this.setOutcome(undefined),
        1_000,
      );
    return super.update(id, input);
  }
}
const repository = new FixtureRepository(0);
const task = await repository.create({
  title: "Sync layout review",
  body: "A short note for checking the editor layout.",
  due: todayString(),
});
repository.targetId = task.id;
if (phase !== "edit")
  repository.setOutcome(
    ["failed", "conflicted", "unknown"].includes(phase)
      ? (phase as RecordWriteStatus)
      : "pending",
  );
if (phase === "fast") setTimeout(() => repository.setOutcome(undefined), 1_200);
history.replaceState({}, "", `/task/${encodeURIComponent(task.id)}`);
Object.defineProperty(window, "syncPresentationStats", {
  value: () => ({ checks: repository.checks, updates: repository.updates }),
});
createRoot(document.getElementById("root")!).render(
  <CollectionGateContext.Provider
    value={{
      collectionUi: null,
      changeCollection: () => {},
      reauthorizeCurrentCollection: () => {},
    }}
  >
    <RepositoryProvider
      repository={repository}
      mutationJournal={new DemoMutationJournal()}
      reminderAuthority="none"
    >
      <AppShell />
    </RepositoryProvider>
  </CollectionGateContext.Provider>,
);
