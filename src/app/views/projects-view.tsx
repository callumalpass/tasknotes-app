import { ChevronRight, Plus } from "lucide-react";
import { useId, useState } from "react";
import {
  sectionCollapsed,
  saveSectionCollapsed,
} from "../../application/section-preferences";

import { TaskRow } from "../../components/task-row";
import {
  linkLabel,
  linkTarget,
  recordCompletion,
  type CollectionRecord,
} from "../../domain/completion";

import type { Task } from "../../domain/task";
import type { TaskViewExecution } from "../../domain/view";

export function ProjectsView({
  execution,
  sectionScope,
  linkWriteFormat,
  projectsField,
  tasks,
  onCreate,
  onOpen,
  onToggle,
}: {
  execution: TaskViewExecution;
  sectionScope?: string;
  projectsField: string;
  linkWriteFormat: "wikilink" | "markdown";
  tasks: readonly Task[];
  onCreate(value: string, label: string): void;
  onOpen(task: Task, occurrenceDate?: string): void;
  onToggle(task: Task, occurrenceDate?: string): void;
}) {
  const id = useId();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const preferenceKey = (key: string) =>
    sectionScope
      ? JSON.stringify([sectionScope, execution.view.key, "project", key])
      : undefined;
  const collapse = (key: string, value: boolean) => {
    setCollapsed((current) => ({ ...current, [key]: value }));
    saveSectionCollapsed(preferenceKey(key), value);
  };
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
        label: linkLabel(value) ?? target.split("/").at(-1) ?? value,
        value,
        tasks: [],
      };
      if (!group.tasks.some((candidate) => candidate.id === task.id))
        group.tasks.push(task);
      groups.set(key, group);
    }
  }

  const ordered = [...groups.entries()]
    .map(([key, project]) => ({ key, ...project }))
    .sort(
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
      <label className="project-index">
        <span>{ordered.length} projects · Jump to</span>
        <select
          aria-label="Jump to project"
          value=""
          onChange={(event) => {
            const index = Number(event.target.value);
            const project = ordered[index];
            if (!project) return;
            collapse(project.key, false);
            const heading = document.getElementById(`${id}-${index}`);
            heading?.querySelector("button")?.focus({ preventScroll: true });
            heading?.scrollIntoView({ block: "start" });
          }}
        >
          <option value="" disabled>
            Choose a project
          </option>
          {ordered.map((project, index) => (
            <option key={project.key} value={index}>
              {project.label}
              {project.path ? ` — ${project.path}` : ""} ({project.tasks.length}
              )
            </option>
          ))}
        </select>
      </label>
      {ordered.map((project, index) => {
        const isCollapsed =
          collapsed[project.key] ??
          sectionCollapsed(preferenceKey(project.key));
        const listId = `${id}-${index}-tasks`;
        return (
          <section
            id={`${id}-${index}`}
            className="project-group"
            key={project.key}
          >
            <header>
              <div>
                <h2>
                  <button
                    className="project-toggle"
                    type="button"
                    aria-expanded={!isCollapsed}
                    aria-controls={listId}
                    onClick={() => collapse(project.key, !isCollapsed)}
                  >
                    <ChevronRight aria-hidden="true" size={16} />
                    <span>{project.label}</span>
                    <span className="project-count">
                      {project.tasks.length}{" "}
                      {project.tasks.length === 1 ? "task" : "tasks"}
                    </span>
                  </button>
                </h2>
                {project.path ? <small>{project.path}</small> : null}
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
            <div id={listId} className="saved-task-list" hidden={isCollapsed}>
              {!isCollapsed &&
                project.tasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onOpen={onOpen}
                    onToggle={onToggle}
                  />
                ))}
            </div>
          </section>
        );
      })}
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
