// Isolated public test data; no account, filesystem, credentials or real log.
import { createRoot } from "react-dom/client";
import {
  RepositoryProvider,
  useRepository,
} from "../src/app/repository-context";
import { DemoTaskRepository } from "../src/demo/demo-task-repository";
import { DemoMutationJournal } from "../src/demo/demo-mutation-journal";
import { HeldEditsReview } from "../src/components/held-edits";
import { CollectionAvailability } from "../src/components/collection-availability";
import { heldEditFromHold } from "../src/storage/held-edits";
import type {
  HeldEditResolution,
  RepositoryConnectionStatus,
} from "../src/application/ports/task-repository";
import "../src/styles.css";
import "../src/accessibility.css";
if (import.meta.env.MODE !== "e2e")
  throw new Error("held-edit fixture requires e2e mode");
class FixtureRepository extends DemoTaskRepository {
  edits = [
    heldEditFromHold(
      {
        id: "00000000-0000-4000-8000-000000000002",
        path: "notes/long-task-with-a-descriptive-name.md",
        reason: "conflict",
        since: 1_800_000_000_000,
        saves: 2,
        mine: "<img src=x onerror=alert(1)>\nHeld task text",
        theirs: "Synced task text",
      },
      "00000000-0000-4000-8000-000000000001",
    ),
  ];
  choices = 0;
  override async connectionStatus(): Promise<RepositoryConnectionStatus> {
    return {
      state: "unavailable",
      heldEdits: this.edits,
      sync: {
        text: `Confirmed through 8, plus ${this.choices} pending, plus ${this.edits.length} held`,
        pending: this.choices,
        held: this.edits.length,
      },
    };
  }
  async resolveHeldEdit(id: string, how: HeldEditResolution) {
    if (
      !this.edits.some(
        (edit) =>
          edit.id === id &&
          edit.actions.some((action) => action.action === how),
      )
    )
      throw new Error("invalid fixture choice");
    this.choices++;
    this.edits = [];
  }
}
const repository = new FixtureRepository(0);
export function Fixture() {
  const { connection } = useRepository();
  return (
    <div className="screen settings-screen">
      <CollectionAvailability onSettings={() => {}} />
      <HeldEditsReview edits={connection.heldEdits ?? []} />
      <output data-testid="selections">Selections: {repository.choices}</output>
      <p>{connection.sync?.text}</p>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <RepositoryProvider
    repository={repository}
    mutationJournal={new DemoMutationJournal()}
  >
    <Fixture />
  </RepositoryProvider>,
);
