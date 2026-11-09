import {
  SnapshotTaskRepository,
  defaultViewDocuments as demoViewDocuments,
} from "../storage/snapshot-task-repository";
import { demoTasks } from "./demo-tasks";
import type { CollectionInfo } from "../application/ports/task-repository";
import { TaskNotesTaskModel } from "../domain/tasknotes-model";
import { resolveTaskCollectionConfiguration } from "../domain/task-configuration";
import { taskNotesDefaultBaseSources } from "../domain/default-view-source";
import {
  scratchpadDocumentPath,
  type ScratchpadDocument,
} from "../domain/scratchpad";
const MAX_DEMO_TASKS = 5_000;
export class DemoTaskRepository extends SnapshotTaskRepository {
  override async collectionInfo(): Promise<CollectionInfo> {
    return {
      kind: "connect",
      id: "tasknotes-demo",
      name: "TaskNotes demo",
      location: "Disposable demo collection",
      runtime: "browser",
    };
  }

  constructor(
    requestedCount = 50,
    adjustDefinition?: (
      definition: Record<string, unknown>,
    ) => Record<string, unknown>,
  ) {
    super();
    if (adjustDefinition) {
      this.modelDefinition = adjustDefinition(this.modelDefinition);
      this.model = new TaskNotesTaskModel(
        resolveTaskCollectionConfiguration(this.modelDefinition),
      );
    }
    const count = Math.max(
      1,
      Math.min(
        Number.isFinite(requestedCount) ? Math.floor(requestedCount) : 50,
        MAX_DEMO_TASKS,
      ),
    );
    const configuration = this.model.configuration();
    this.documents = demoViewDocuments(configuration);
    for (const source of taskNotesDefaultBaseSources(configuration)) {
      this.sources.set(source.path, {
        path: source.path,
        format: "obsidian.base",
        revision: "demo-view-1",
        document: source.document,
      });
    }
    this.sources.set("TaskNotes/Views/work-board.base", {
      path: "TaskNotes/Views/work-board.base",
      format: "obsidian.base",
      revision: "demo-view-1",
      document:
        "views:\n  - name: Work board\n    type: tasknotesKanban\n    groupBy:\n      property: status\n    sort:\n      - property: sortOrder\n        direction: DESC\n",
    });
    for (const task of demoTasks(this.model, count))
      this.tasks.set(task.id, this.model.read(task));

    const now = new Date().toISOString();
    const current: ScratchpadDocument = {
      id: "demo-scratchpad",
      path: scratchpadDocumentPath(new Date(now), "demo-scratchpad"),
      revision: "scratch-1",
      state: "active",
      dateCreated: now,
      dateModified: now,
      body: [
        "- [ ] Ask Rowan about the research notes",
        "  - [ ] Pull the last three examples",
        "- Meeting notes for the planning session",
        "  - Decisions belong in the project brief",
        "- [[tasks/prepare-quarterly-planning-session|Prepare quarterly planning session]]",
        "",
      ].join("\n"),
    };
    this.scratchpads.set(current.id, current);
    this.scratchImages.set("demo-scratch-image", {
      kind: "image",
      id: "demo-scratch-image",
      path: "TaskNotes/Scratchpad/Image Metadata/demo-scratch-image.md",
      revision: "scratch-image-1",
      dateCreated: new Date(
        Date.parse(now) - 2 * 24 * 60 * 60 * 1_000,
      ).toISOString(),
      dateModified: new Date(
        Date.parse(now) - 2 * 24 * 60 * 60 * 1_000,
      ).toISOString(),
      file: "TaskNotes/Scratchpad/Images/demo-reference.png",
      digest: `sha256:${"0".repeat(64)}`,
      size: 0,
      mediaType: "image/png",
      width: 4,
      height: 3,
      caption: "Demo image reference",
    });
    for (const historical of [
      demoScratchpad(
        "demo-scratchpad-planning",
        new Date(Date.parse(now) - 24 * 60 * 60 * 1_000).toISOString(),
        "Planning notes",
        "- Agree launch owners\n- [ ] Confirm the review date\n",
      ),
      demoScratchpad(
        "demo-scratchpad-research",
        new Date(Date.parse(now) - 5 * 24 * 60 * 60 * 1_000).toISOString(),
        "Research follow-up",
        "- Three examples stood out\n- [ ] Send Rowan the summary\n",
      ),
    ])
      this.scratchpads.set(historical.id, historical);
  }
}

function demoScratchpad(
  id: string,
  dateCreated: string,
  title: string,
  body: string,
): ScratchpadDocument {
  return {
    id,
    path: scratchpadDocumentPath(new Date(dateCreated), id),
    revision: "scratch-1",
    state: "converted",
    dateCreated,
    dateModified: dateCreated,
    dateConverted: dateCreated,
    title,
    body,
  };
}
