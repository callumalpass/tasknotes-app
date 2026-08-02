import { Plus } from "lucide-react";

import { TaskRow } from "../../components/task-row";
import {
  linkTarget,
  recordCompletion,
  type CollectionRecord,
} from "../../domain/completion";

import type { Task } from "../../domain/task";
import type { TaskViewExecution } from "../../domain/view";

export function ProjectsView({
  execution,
  linkWriteFormat,
  projectsField,
  tasks,
  onCreate,
  onOpen,
  onToggle,
}: {
  execution: TaskViewExecution;
  projectsField: string;
  linkWriteFormat: "wikilink" | "markdown";
  tasks: readonly Task[];
  onCreate(value: string, label: string): void;
  onOpen(task: Task, occurrenceDate?: string): void;
  onToggle(task: Task, occurrenceDate?: string): void;
}) {
  const activeTasks = tasks.filter((task) => !task.completed && !task.archived);
  const records = indexProjectRecords(
    (execution.records ?? []).map(({ record }) => record),
  );
  const groups = new Map<
    string,
    { label: string; path?: string; value: string; tasks: Task[] }
  >();

  for (const task of activeTasks) {
    const values = task.projects.length
      ? task.projects
      : listStrings(task.frontmatter[projectsField]);
    for (const value of values) {
      const target = linkTarget(value);
      const normalizedTarget = target.toLocaleLowerCase();
      const matches = normalizedTarget.includes("/")
        ? (records.byPath.get(normalizedTarget) ?? [])
        : (records.byBasename.get(normalizedTarget) ?? []);
      if (matches.length) {
        for (const record of matches) {
          const key = `record:${record.path.toLocaleLowerCase()}`;
          const group = groups.get(key) ?? {
            label: record.label,
            path: record.path,
            value: recordCompletion(record, linkWriteFormat).value,
            tasks: [],
          };
          if (!group.tasks.some((candidate) => candidate.id === task.id))
            group.tasks.push(task);
          groups.set(key, group);
        }
        continue;
      }
      const key = `link:${target.toLocaleLowerCase()}`;
      const group = groups.get(key) ?? {
        label: target.split("/").at(-1) || value,
        value,
        tasks: [],
      };
      if (!group.tasks.some((candidate) => candidate.id === task.id))
        group.tasks.push(task);
      groups.set(key, group);
    }
  }

  const ordered = [...groups.values()].sort(
    (left, right) =>
      left.label.localeCompare(right.label) ||
      (left.path ?? "").localeCompare(right.path ?? ""),
  );
  if (!ordered.length)
    return (
      <div className="plain-empty">
        <h2>No active projects</h2>
        <p>Add a project to a task and it will appear here.</p>
      </div>
    );
  return (
    <div className="projects-view">
      {ordered.map((project) => (
        <section className="project-group" key={project.path ?? project.value}>
          <header>
            <div>
              <h2>{project.label}</h2>
              <small>
                {project.path ??
                  `${project.tasks.length} linked ${
                    project.tasks.length === 1 ? "task" : "tasks"
                  }`}
              </small>
            </div>
            <button
              aria-label={`Add task to ${project.label}`}
              type="button"
              onClick={() => onCreate(project.value, project.label)}
            >
              <Plus aria-hidden="true" size={16} />
              Add task
            </button>
          </header>
          <div className="saved-task-list">
            {project.tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                onOpen={onOpen}
                onToggle={onToggle}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function listStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : typeof value === "string"
      ? [value]
      : [];
}

function indexProjectRecords(records: readonly CollectionRecord[]): {
  byPath: Map<string, CollectionRecord[]>;
  byBasename: Map<string, CollectionRecord[]>;
} {
  const byPath = new Map<string, CollectionRecord[]>();
  const byBasename = new Map<string, CollectionRecord[]>();
  for (const record of records) {
    const path = linkTarget(record.path).toLocaleLowerCase();
    addIndexedRecord(byPath, path, record);
    addIndexedRecord(byBasename, path.split("/").at(-1) ?? path, record);
  }
  return { byPath, byBasename };
}

function addIndexedRecord(
  index: Map<string, CollectionRecord[]>,
  key: string,
  record: CollectionRecord,
): void {
  const values = index.get(key);
  if (values) values.push(record);
  else index.set(key, [record]);
}
