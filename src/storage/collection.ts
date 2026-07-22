import {
  parseFrontmatter,
  serializeMarkdownDocument,
} from "@tasknotes/model/frontmatter";
import { buildTaskNotesMdbaseResources } from "@tasknotes/model/mdbase";
import { parseDocument } from "yaml";

import { TaskNotesTaskModel } from "../domain/tasknotes-model";
import { resolveTaskCollectionConfiguration } from "../domain/task-configuration";
import {
  upgradeManagedTaskDocument,
  upgradeManagedTaskType,
} from "./collection-migration";

import type {
  CreateTaskInput,
  Task,
  TaskTimeEntry,
  UpdateTaskInput,
} from "../domain/task";
import type { TaskCollectionConfiguration } from "../domain/task-configuration";
import type { Vault, VaultEntry } from "./vault";

export class MarkdownCollection {
  private taskModel = new TaskNotesTaskModel();

  constructor(private readonly vault: Vault) {}

  async initialize(): Promise<void> {
    await this.vault.initialize();
    const resources = buildTaskNotesMdbaseResources();
    await this.vault.ensureText(
      resources.paths.config,
      resources.configDocument,
    );
    await this.ensureViewConfiguration(resources.paths.config);
    await this.vault.ensureText(resources.paths.type, resources.typeDocument);
    const parsedType = parseFrontmatter(
      await this.vault.readText(resources.paths.type),
    );
    const upgraded = upgradeManagedTaskType(parsedType.frontmatter);
    if (upgraded.changed) {
      await this.upgradeDocuments(upgraded.completedField);
      await this.vault.writeText(
        resources.paths.type,
        serializeMarkdownDocument(upgraded.frontmatter, parsedType.body),
      );
    }
    this.taskModel = new TaskNotesTaskModel(
      resolveTaskCollectionConfiguration(upgraded.frontmatter),
    );
  }

  async list(): Promise<VaultEntry[]> {
    const roots = new Set([this.taskModel.recordsFolderPath()]);
    const configuration = this.taskModel.configuration();
    if (configuration.archive.moveOnArchive)
      roots.add(configuration.archive.folder);
    const entries = await Promise.all(
      [...roots].map((root) =>
        this.vault.listMarkdownFiles(root).catch((reason: unknown) => {
          if (isMissingPath(reason)) return [];
          throw reason;
        }),
      ),
    );
    return [
      ...new Map(entries.flat().map((entry) => [entry.path, entry])).values(),
    ].sort((left, right) => left.path.localeCompare(right.path));
  }

  listViewSources(): Promise<VaultEntry[]> {
    return this.vault.listFiles("views", [".base"]);
  }

  readText(path: string): Promise<string> {
    return this.vault.readText(path);
  }

  async read(document: VaultEntry): Promise<Task | null> {
    try {
      const parsed = parseFrontmatter(await this.vault.readText(document.path));
      return this.taskModel.read({
        path: document.path,
        frontmatter: parsed.frontmatter,
        body: parsed.body,
      });
    } catch {
      return null;
    }
  }

  createTask(input: CreateTaskInput, id: string, now: string): Promise<Task> {
    return this.taskModel.createWithTemplate(input, { id, now }, (path) =>
      this.vault.readText(path),
    );
  }

  updateTask(task: Task, input: UpdateTaskInput, now: string): Task {
    return this.taskModel.update(task, input, { now });
  }

  toggleTask(task: Task, now: string, currentDate?: string): Task {
    return this.taskModel.toggle(task, { now, currentDate });
  }

  skipTask(task: Task, now: string, currentDate: string): Task {
    return this.taskModel.skip(task, { now, currentDate });
  }

  startTimeTracking(task: Task, now: string, description?: string): Task {
    return this.taskModel.startTimeTracking(task, { now, description });
  }

  stopTimeTracking(task: Task, now: string): Task {
    return this.taskModel.stopTimeTracking(task, { now });
  }

  replaceTimeEntries(task: Task, entries: TaskTimeEntry[], now: string): Task {
    return this.taskModel.replaceTimeEntries(task, entries, { now });
  }

  removeTimeEntry(task: Task, index: number, now: string): Task {
    return this.taskModel.removeTimeEntry(task, index, { now });
  }

  taskConfiguration(): TaskCollectionConfiguration {
    return this.taskModel.configuration();
  }

  write(task: Task): Promise<VaultEntry> {
    return this.vault.writeText(
      task.path,
      serializeMarkdownDocument(task.frontmatter, task.body),
    );
  }

  rename(from: string, to: string): Promise<VaultEntry> {
    return this.vault.rename(from, to);
  }

  archiveDestination(task: Task, archived: boolean): string | undefined {
    return this.taskModel.archiveDestination(task, archived);
  }

  delete(path: string): Promise<void> {
    return this.vault.delete(path);
  }

  exists(path: string): Promise<boolean> {
    return this.vault.exists(path);
  }

  location(): string {
    return this.vault.location();
  }

  kind(): Vault["kind"] {
    return this.vault.kind;
  }

  private async upgradeDocuments(completedField: string): Promise<void> {
    const documents = await this.list();
    for (const batch of batches(documents, 64)) {
      await Promise.all(
        batch.map(async (document) => {
          try {
            const parsed = parseFrontmatter(
              await this.vault.readText(document.path),
            );
            const upgraded = upgradeManagedTaskDocument(
              parsed.frontmatter,
              completedField,
            );
            if (upgraded.changed)
              await this.vault.writeText(
                document.path,
                serializeMarkdownDocument(upgraded.frontmatter, parsed.body),
              );
          } catch {
            // Invalid user records remain untouched and are omitted from the index.
          }
        }),
      );
    }
  }

  private async ensureViewConfiguration(configPath: string): Promise<void> {
    const source = await this.vault.readText(configPath);
    const document = parseDocument(source);
    if (document.hasIn(["x-obsidian", "bases"])) return;
    document.setIn(["x-obsidian", "bases"], {
      include: ["views/**/*.base"],
      create_folder: "views",
      default_for_new_views: true,
    });
    await this.vault.writeText(configPath, String(document));
  }
}

export function batches<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size)
    result.push(values.slice(offset, offset + size));
  return result;
}

function isMissingPath(reason: unknown): boolean {
  return (
    (reason instanceof DOMException && reason.name === "NotFoundError") ||
    /not exist|not found/i.test(String(reason))
  );
}
