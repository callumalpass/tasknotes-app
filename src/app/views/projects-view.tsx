import { TaskSelectionList } from "../task-selection";
import { t as translate } from "@lingui/core/macro";
import { useLingui, Trans } from "@lingui/react/macro";
import { countLabel } from "../../i18n/default-labels";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import {
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  sectionCollapsed,
  saveSectionCollapsed,
} from "../../application/section-preferences";

import {
  BoundedList,
  type BoundedListHandle,
} from "../../components/bounded-list";
import { TaskRow } from "../../components/task-row";
import { TaskNotesSelect } from "../../components/tasknotes-controls";
import {
  clearProjectJump,
  onProjectJump,
  peekProjectJump,
  setFocusedProject,
  takeProjectJump,
  useFocusedProject,
} from "../project-jump";
import {
  TaskCompletionHoldsContext,
  TaskDeparturesContext,
} from "../../components/task-completion-motion";
import {
  linkLabel,
  linkTarget,
  recordCompletion,
  type CollectionRecord,
} from "../../domain/completion";
import { projectLabel } from "../../domain/project-shortcuts";

import type { TaskSummary } from "../../domain/task";
import type { ViewProps } from "./view-props";

type Project = {
  key: string;
  label: string;
  path?: string;
  value: string;
  tasks: TaskSummary[];
};

type ProjectEntry = {
  key: string;
  project: Project;
  headerIndex: number;
  index: number;
  task?: TaskSummary;
};

const projectHeadingKey = (key: string) => `heading:${key}`;
const entryKey = (entry: ProjectEntry) => entry.key;
const entryTaskId = (entry: ProjectEntry) => entry.task?.id;
const entryEstimate = (entry: ProjectEntry) =>
  entry.task ? 48 : entry.index ? 87 : 57;

export function ProjectsView({
  execution,
  sectionScope,
  linkWriteFormat,
  projectsField,
  tasks,
  onCreate,
  onOpen,
  onToggle,
}: ViewProps & {
  sectionScope?: string;
  projectsField: string;
  linkWriteFormat: "wikilink" | "markdown";
  tasks: readonly TaskSummary[];
  onCreate(value: string, label: string): void;
}) {
  const { t } = useLingui();
  const id = useId();
  const list = useRef<BoundedListHandle>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const preferenceKey = useCallback(
    (key: string) =>
      sectionScope
        ? JSON.stringify([sectionScope, execution.view.key, "project", key])
        : undefined,
    [sectionScope, execution.view.key],
  );
  const collapse = (key: string, value: boolean) => {
    setCollapsed((current) => ({ ...current, [key]: value }));
    saveSectionCollapsed(preferenceKey(key), value);
  };
  // A just-completed task stays in its project until its row has folded.
  const holds = useContext(TaskCompletionHoldsContext);
  const departing = useMemo(
    () =>
      new Map(
        tasks
          .filter((task) => task.completed && holds.has(task.id))
          .map((task) => [task.id, holds.get(task.id) ?? null]),
      ),
    [tasks, holds],
  );
  const activeTasks = useHeldOrder(
    useMemo(
      () =>
        tasks.filter(
          (task) =>
            (!task.completed || departing.has(task.id)) && !task.archived,
        ),
      [tasks, departing],
    ),
    departing.size > 0,
  );
  const ordered = useMemo(
    () =>
      groupProjects(
        activeTasks,
        (execution.records ?? []).map(({ record }) => record),
        projectsField,
        linkWriteFormat,
      ),
    [activeTasks, execution.records, projectsField, linkWriteFormat],
  );
  const count = (project: Project) =>
    departing.size
      ? project.tasks.filter((task) => !departing.has(task.id)).length
      : project.tasks.length;
  const focusedLabel = useFocusedProject();
  const findProject = (label: string | null) =>
    label
      ? ordered.find(
          (candidate) =>
            candidate.label === label ||
            candidate.tasks.some((task) =>
              task.projects.some((value) => projectLabel(value) === label),
            ),
        )
      : undefined;
  const focused = findProject(focusedLabel);
  const shown = useMemo(
    () => (focused ? [focused] : ordered),
    [focused, ordered],
  );
  const expanded = useMemo(
    () =>
      new Set(
        shown
          .filter(
            ({ key }) =>
              !(collapsed[key] ?? sectionCollapsed(preferenceKey(key))),
          )
          .map(({ key }) => key),
      ),
    [shown, collapsed, preferenceKey],
  );
  const groupIds = useMemo(
    () => new Map(ordered.map(({ key }, index) => [key, `${id}-${index}`])),
    [id, ordered],
  );
  const windowed =
    shown.reduce((total, project) => total + project.tasks.length, 0) > 100;
  const entries = useMemo(() => {
    if (!windowed) return [];
    const result: ProjectEntry[] = [];
    for (const [index, project] of shown.entries()) {
      const headerIndex = result.length;
      result.push({
        key: projectHeadingKey(project.key),
        project,
        headerIndex,
        index,
      });
      if (!expanded.has(project.key)) continue;
      for (const task of project.tasks)
        result.push({
          key: JSON.stringify([project.key, task.id]),
          project,
          headerIndex,
          index,
          task,
        });
    }
    return result;
  }, [expanded, shown, windowed]);
  const relatedIndices = useCallback(
    (index: number) => [entries[index].headerIndex],
    [entries],
  );
  const visibleTasks = useMemo(
    () =>
      shown.flatMap((project) =>
        expanded.has(project.key)
          ? project.tasks.filter((task) => !departing.has(task.id))
          : [],
      ),
    [departing, expanded, shown],
  );
  const focusProject = (label: string | null) => {
    const project = findProject(label);
    if (!project) return false;
    collapse(project.key, false);
    setFocusedProject(project.label);
    window.scrollTo({ top: 0 });
    return true;
  };
  const jumpTo = (label: string | null) => {
    const project = ordered.find((project) => project.label === label);
    if (!project) return;
    collapse(project.key, false);
    if (list.current) {
      list.current.reveal(
        projectHeadingKey(project.key),
        ".project-toggle",
        "start",
      );
      return;
    }
    // The jump picker returns focus to itself after onChange, so wait a frame.
    requestAnimationFrame(() => {
      const heading = document.getElementById(groupIds.get(project.key)!);
      heading?.querySelector("button")?.focus({ preventScroll: true });
      heading?.scrollIntoView({ block: "start" });
    });
  };
  const applyPendingJump = useEffectEvent(() => {
    const label = peekProjectJump();
    if (!label) return;
    if (focusProject(label)) takeProjectJump();
  });
  useEffect(() => {
    if (!peekProjectJump()) return;
    const frame = requestAnimationFrame(applyPendingJump);
    return () => cancelAnimationFrame(frame);
  }, [ordered.length, tasks]);
  useEffect(() => {
    const stop = onProjectJump(applyPendingJump);
    return () => {
      stop();
      setFocusedProject(null);
    };
  }, []);
  if (!ordered.length)
    return (
      <div className="plain-empty">
        <h2>
          <Trans>No active projects</Trans>
        </h2>
        <p>
          <Trans>Add a project to a task and it will appear here.</Trans>
        </p>
      </div>
    );
  const renderTask = (task: TaskSummary, project: Project) => (
    <TaskRow
      key={task.id}
      task={task}
      contextProperties={{ projects: project.value }}
      onOpen={(target, occurrence) =>
        onOpen(
          target,
          occurrence,
          visibleTasks.map(({ id }) => ({ id })),
        )
      }
      onToggle={onToggle}
    />
  );
  const renderHeading = (
    project: Project,
    isExpanded: boolean,
    listId: string,
  ) => {
    const taskCount = count(project);
    return (
      <header className="project-group-header" data-expanded={isExpanded}>
        <div>
          <h2>
            <button
              className="project-toggle"
              type="button"
              aria-expanded={isExpanded}
              aria-controls={listId}
              onClick={() =>
                focused ? undefined : collapse(project.key, isExpanded)
              }
            >
              {focused ? null : <ChevronRight aria-hidden="true" size={16} />}
              <span>{project.label}</span>
              <span className="project-count">
                {taskCount}{" "}
                {taskCount === 1
                  ? translate({ message: "task" })
                  : translate({ message: "tasks" })}
              </span>
            </button>
          </h2>
          {project.path ? <small>{project.path}</small> : null}
        </div>
        <button
          aria-label={t`Add task to ${project.label}`}
          type="button"
          onClick={() => onCreate(project.value, project.label)}
        >
          <Plus aria-hidden="true" size={16} />
          <Trans>Add task</Trans>
        </button>
      </header>
    );
  };
  const listId = (key: string) => `${groupIds.get(key)}-tasks`;

  return (
    <TaskSelectionList tasks={visibleTasks}>
      <div className={`projects-view${focused ? " is-focused" : ""}`}>
        {focused ? (
          <button
            className="project-back"
            type="button"
            onClick={() => {
              clearProjectJump();
              setFocusedProject(null);
            }}
          >
            <ChevronLeft aria-hidden="true" size={16} />
            <Trans>All projects</Trans>
          </button>
        ) : (
          <label className="project-index">
            <span>{countLabel(ordered.length, "project")}</span>
            <TaskNotesSelect
              ariaLabel={t({ message: "Jump to project" })}
              options={ordered.map((project) => ({
                value: project.label,
                label: `${project.label} (${count(project)})`,
                description: project.path,
              }))}
              placeholder={t({ message: "Jump to project" })}
              value=""
              onChange={jumpTo}
            />
          </label>
        )}
        <TaskDeparturesContext.Provider value={departing}>
          {windowed ? (
            <BoundedList
              ref={list}
              className="project-window"
              items={entries}
              getKey={entryKey}
              taskId={entryTaskId}
              estimateSize={entryEstimate}
              relatedIndices={relatedIndices}
              navigateTasks
              group={{
                key: (entry) => entry.project.key,
                render: (key, [heading, ...rows]) => (
                  <section className="project-group" key={key}>
                    {heading}
                    <div id={listId(key)} hidden={!expanded.has(key)}>
                      {rows}
                    </div>
                  </section>
                ),
              }}
              renderItem={({ project, task, index }) =>
                task ? (
                  renderTask(task, project)
                ) : (
                  <div className={index ? "project-window-heading" : undefined}>
                    {renderHeading(
                      project,
                      expanded.has(project.key),
                      listId(project.key),
                    )}
                  </div>
                )
              }
            />
          ) : (
            shown.map((project) => (
              <section
                id={groupIds.get(project.key)}
                className="project-group"
                key={project.key}
              >
                {renderHeading(
                  project,
                  expanded.has(project.key),
                  listId(project.key),
                )}
                <div
                  id={listId(project.key)}
                  className="saved-task-list"
                  hidden={!expanded.has(project.key)}
                >
                  {expanded.has(project.key) &&
                    project.tasks.map((task) => renderTask(task, project))}
                </div>
              </section>
            ))
          )}
        </TaskDeparturesContext.Provider>
      </div>
    </TaskSelectionList>
  );
}

function groupProjects(
  activeTasks: readonly TaskSummary[],
  records: readonly CollectionRecord[],
  projectsField: string,
  linkWriteFormat: "wikilink" | "markdown",
): Project[] {
  const projectRecords = indexProjectRecords(records);
  const groups = new Map<
    string,
    {
      label: string;
      path?: string;
      value: string;
      tasks: Map<string, TaskSummary>;
    }
  >();

  for (const task of activeTasks) {
    const values = task.projects.length
      ? task.projects
      : listStrings(task.frontmatter[projectsField]);
    for (const value of values) {
      const target = linkTarget(value);
      const normalizedTarget = target.toLocaleLowerCase();
      const matches = normalizedTarget.includes("/")
        ? (projectRecords.byPath.get(normalizedTarget) ?? [])
        : (projectRecords.byBasename.get(normalizedTarget) ?? []);
      if (matches.length) {
        for (const record of matches) {
          const key = `record:${record.path.toLocaleLowerCase()}`;
          const group = groups.get(key) ?? {
            label: record.label,
            path: record.path,
            value: recordCompletion(record, linkWriteFormat).value,
            tasks: new Map<string, TaskSummary>(),
          };
          if (!group.tasks.has(task.id)) group.tasks.set(task.id, task);
          groups.set(key, group);
        }
        continue;
      }
      const key = `link:${target.toLocaleLowerCase()}`;
      const group = groups.get(key) ?? {
        label: linkLabel(value) ?? target.split("/").at(-1) ?? value,
        value,
        tasks: new Map<string, TaskSummary>(),
      };
      if (!group.tasks.has(task.id)) group.tasks.set(task.id, task);
      groups.set(key, group);
    }
  }

  return [...groups.entries()]
    .map(([key, project]) => ({
      ...project,
      key,
      tasks: [...project.tasks.values()],
    }))
    .sort(
      (left, right) =>
        left.label.localeCompare(right.label) ||
        (left.path ?? "").localeCompare(right.path ?? ""),
    );
}

/**
 * Completing can move a task within the source list; while a completion is
 * held, tasks keep the order they were last shown in so the row stays put.
 */
function useHeldOrder(tasks: TaskSummary[], holding: boolean): TaskSummary[] {
  const ids = tasks.map((task) => task.id);
  const [shown, setShown] = useState(ids);
  if (!holding && shown.join("\n") !== ids.join("\n")) setShown(ids);
  if (!holding) return tasks;
  const position = new Map(shown.map((id, index) => [id, index]));
  return [...tasks].sort(
    (left, right) =>
      (position.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
      (position.get(right.id) ?? Number.MAX_SAFE_INTEGER),
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
