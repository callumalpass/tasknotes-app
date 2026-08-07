import { ArrowLeft } from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { attachmentPathFromReference } from "@tasknotes/model/attachments";

import { LoadingRows } from "../components/loading";
import { TaskAttachments } from "../components/task-attachments";
import { TaskActions } from "../components/task-actions";
import { AttachmentService } from "../application/attachments/attachment-service";
import { DependencyEditor, RelatedWork } from "../components/dependency-editor";
import { OperationErrorNotice } from "../components/operation-error-notice";
import { RecurrenceField } from "../components/recurrence-field";
import { ReminderEditor } from "../components/reminder-editor";
import {
  TaskNotesDateField,
  TaskNotesDateTimeField,
  TaskNotesSelect,
  TaskNotesSelectField,
} from "../components/tasknotes-controls";
import {
  activeTimeEntry,
  combineTaskDateTime,
  taskDatePart,
  taskTimePart,
} from "../domain/task";
import { recordMatchesLink } from "../domain/completion";
import {
  useRepository,
  useTask,
  useTaskRelationships,
} from "./repository-context";
import { TimeTrackingField } from "./task-time-tracking";
import {
  Choice,
  Fieldset,
  ListField,
  TaskFormSection,
} from "./task-editor-layout";
import {
  isEmptyFieldValue,
  organizeSummary,
  repeatSummary,
  timeSummary,
  toDraft,
  type Draft,
} from "./task-editor-draft";

import type { Task, UpdateTaskInput } from "../domain/task";
import type {
  FieldCompletionRequest,
  FieldCompletion,
} from "../domain/completion";
import type {
  TaskFieldCompletionConfiguration,
  TaskUserMappedField,
} from "../domain/task-configuration";

const MarkdownPreview = lazy(async () => ({
  default: (await import("../components/markdown-preview")).MarkdownPreview,
}));

type SaveState = "saved" | "saving" | "error";
export function TaskScreen({
  id,
  occurrenceDate,
  onBack,
  onMaterialized,
}: {
  id: string;
  occurrenceDate?: string;
  onBack(): void;
  onMaterialized(task: Task): void;
}) {
  const { task, loading, error } = useTask(id);
  if (loading)
    return (
      <section className="screen task-screen">
        <LoadingRows count={5} />
      </section>
    );
  if (error || !task)
    return (
      <section className="screen task-screen">
        <button className="back-action" type="button" onClick={onBack}>
          <ArrowLeft size={20} /> Back
        </button>
        {error ? (
          <OperationErrorNotice
            action="The task"
            message={error.message}
            recovery="Go back and refresh the collection."
          />
        ) : (
          <p className="inline-error" role="alert">
            Task not found. It may have been deleted or moved.
          </p>
        )}
      </section>
    );
  return (
    <TaskEditor
      key={`${task.id}:${occurrenceDate ?? "record"}`}
      task={task}
      occurrenceDate={occurrenceDate}
      onBack={onBack}
      onMaterialized={onMaterialized}
    />
  );
}

function TaskEditor({
  task,
  occurrenceDate,
  onBack,
  onMaterialized,
}: {
  task: Task;
  occurrenceDate?: string;
  onBack(): void;
  onMaterialized(task: Task): void;
}) {
  const {
    updateTask,
    toggleTask,
    skipTask,
    materializeOccurrence,
    startTimeTracking,
    stopTimeTracking,
    replaceTimeEntries,
    removeTimeEntry,
    configuration,
    repository,
  } = useRepository();
  const { relationships: repositoryRelationships } = useTaskRelationships(
    task.id,
  );
  const completeField = useCallback(
    (request: FieldCompletionRequest) => repository.completeField(request),
    [repository],
  );
  const attachmentService = useMemo(
    () => new AttachmentService(repository),
    [repository],
  );
  const resolveTaskImage = useCallback(
    async (reference: string): Promise<Blob | null> => {
      if (!repository.files) return null;
      const path = attachmentPathFromReference(reference, task.path);
      if (!path) return null;
      const separator = path.lastIndexOf("/");
      const folder = separator < 0 ? undefined : path.slice(0, separator);
      const file = (await repository.files.list({ folder })).find(
        (candidate) => candidate.path === path,
      );
      return file ? repository.files.download(file) : null;
    },
    [repository, task.path],
  );
  const completeDependencyField = useCallback(
    async (request: FieldCompletionRequest) => {
      const options = await repository.completeField(request);
      return options.filter(
        (option) =>
          option.value !== task.id &&
          !recordMatchesLink(task.path, option.value),
      );
    },
    [repository, task.id, task.path],
  );
  const [draft, setDraft] = useState<Draft>(() => toDraft(task));
  const [notesMode, setNotesMode] = useState<"write" | "preview">("write");
  const relationships = useMemo(
    () => ({
      ...repositoryRelationships,
      blockedBy: draft.blockedBy.map((dependency) => {
        const resolved = repositoryRelationships.blockedBy.find(
          (candidate) =>
            candidate.dependency.uid === dependency.uid ||
            (candidate.task &&
              recordMatchesLink(candidate.task.path, dependency.uid)),
        );
        return {
          dependency,
          task: resolved?.task,
        };
      }),
    }),
    [draft.blockedBy, repositoryRelationships],
  );
  const projectLabels = useMemo(
    () =>
      new Map(
        draft.projects.flatMap((project) => {
          const task = repositoryRelationships.projectTasks.find((candidate) =>
            recordMatchesLink(candidate.path, project),
          );
          return task ? [[project, task.title] as const] : [];
        }),
      ),
    [draft.projects, repositoryRelationships.projectTasks],
  );
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [occurrenceAction, setOccurrenceAction] = useState(false);
  const [occurrenceError, setOccurrenceError] = useState<string | null>(null);
  const [timeAction, setTimeAction] = useState(false);
  const [timeError, setTimeError] = useState<string | null>(null);
  const mounted = useRef(true);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const editVersion = useRef(0);
  const draftRef = useRef(draft);
  const dirtyRef = useRef(false);
  const savesInFlight = useRef(new Map<number, Promise<void>>());
  const resizeTitle = useCallback(() => {
    const field = titleRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
  }, []);

  useLayoutEffect(resizeTitle, [draft.title, resizeTitle]);

  useEffect(() => {
    window.addEventListener("resize", resizeTitle);
    return () => window.removeEventListener("resize", resizeTitle);
  }, [resizeTitle]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const persist = useCallback(
    (value: Draft, version: number): Promise<void> => {
      const existing = savesInFlight.current.get(version);
      if (existing) return existing;
      if (!value.title.trim()) {
        if (mounted.current) {
          setSaveError("Add a title before leaving this task.");
          setSaveState("error");
        }
        return Promise.resolve();
      }
      if (mounted.current) {
        setSaveState("saving");
        setSaveError(null);
      }
      const run = (async () => {
        try {
          const input: UpdateTaskInput = {
            title: value.title,
            status: value.status,
            priority: value.priority,
            due: value.due ?? null,
            scheduled: value.scheduled ?? null,
            body: value.body,
            tags: value.tags,
            contexts: value.contexts,
            projects: value.projects,
            blockedBy: value.blockedBy,
            recurrence: value.recurrence ?? null,
            recurrenceAnchor: value.recurrenceAnchor,
            occurrenceMaterialization: value.occurrenceMaterialization,
            occurrenceNextTrigger: value.occurrenceNextTrigger,
            occurrenceTemplate: value.occurrenceTemplate ?? null,
            occurrencePastHorizon: value.occurrencePastHorizon ?? null,
            occurrenceFutureHorizon: value.occurrenceFutureHorizon ?? null,
            reminders: value.reminders,
            timeEstimate: value.timeEstimate ?? null,
            customProperties: value.customProperties,
          };
          await updateTask(task.id, input);
          if (editVersion.current === version) {
            dirtyRef.current = false;
            if (mounted.current) {
              setDirty(false);
              setSaveState("saved");
            }
          }
        } catch (reason) {
          const error =
            reason instanceof Error ? reason : new Error(String(reason));
          if (mounted.current && editVersion.current === version) {
            setSaveError(error.message);
            setSaveState("error");
          }
          throw error;
        } finally {
          savesInFlight.current.delete(version);
        }
      })();
      savesInFlight.current.set(version, run);
      return run;
    },
    [task.id, updateTask],
  );

  useEffect(() => {
    if (!dirty) return;
    const version = editVersion.current;
    const timeout = window.setTimeout(
      () => void persist(draft, version).catch(() => undefined),
      520,
    );
    return () => window.clearTimeout(timeout);
  }, [dirty, draft, persist]);

  useEffect(() => {
    const flush = () => {
      if (!dirtyRef.current || !draftRef.current.title.trim()) return;
      void persist(draftRef.current, editVersion.current).catch(
        () => undefined,
      );
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
    };
  }, [persist]);

  function change(patch: Partial<Draft>) {
    editVersion.current += 1;
    setDraft((value) => {
      const next = { ...value, ...patch };
      draftRef.current = next;
      return next;
    });
    dirtyRef.current = true;
    setDirty(true);
  }

  function changeCustomProperty(key: string, value: unknown) {
    const customProperties = { ...draft.customProperties };
    if (isEmptyFieldValue(value)) delete customProperties[key];
    else customProperties[key] = value;
    change({ customProperties });
  }

  async function flushBeforeAttachmentMutation(): Promise<void> {
    if (dirtyRef.current) await persist(draftRef.current, editVersion.current);
  }

  async function insertAttachmentInline(reference: string): Promise<void> {
    const embed = `!${reference}`;
    if (draftRef.current.body.includes(embed)) return;
    editVersion.current += 1;
    const version = editVersion.current;
    const body = `${draftRef.current.body.trimEnd()}${draftRef.current.body.trim() ? "\n\n" : ""}${embed}\n`;
    const next = { ...draftRef.current, body };
    draftRef.current = next;
    dirtyRef.current = true;
    setDraft(next);
    setDirty(true);
    await persist(next, version);
  }

  async function leave() {
    if (leaving) return;
    if (!draft.title.trim()) {
      setSaveState("error");
      return;
    }
    setLeaving(true);
    try {
      if (dirtyRef.current)
        await persist(draftRef.current, editVersion.current);
      onBack();
    } catch {
      // persist owns the visible save error; keep the editor open for retry.
    } finally {
      if (mounted.current) setLeaving(false);
    }
  }

  async function toggleOccurrence() {
    const date = occurrenceDate ?? task.occurrenceDate;
    if (!date || occurrenceAction) return;
    setOccurrenceAction(true);
    setOccurrenceError(null);
    try {
      await toggleTask(task.id, task.occurrenceDate ? undefined : date);
    } catch (reason) {
      if (mounted.current)
        setOccurrenceError(
          reason instanceof Error ? reason.message : String(reason),
        );
    } finally {
      if (mounted.current) setOccurrenceAction(false);
    }
  }

  async function toggleSkippedOccurrence() {
    const date = occurrenceDate ?? task.occurrenceDate;
    if (!date || occurrenceAction) return;
    setOccurrenceAction(true);
    setOccurrenceError(null);
    try {
      await skipTask(task.id, date);
    } catch (reason) {
      if (mounted.current)
        setOccurrenceError(
          reason instanceof Error ? reason.message : String(reason),
        );
    } finally {
      if (mounted.current) setOccurrenceAction(false);
    }
  }

  async function materialize() {
    if (!occurrenceDate || occurrenceAction) return;
    setOccurrenceAction(true);
    setOccurrenceError(null);
    try {
      const result = await materializeOccurrence(task.id, occurrenceDate);
      onMaterialized(result.task);
    } catch (reason) {
      if (mounted.current)
        setOccurrenceError(
          reason instanceof Error ? reason.message : String(reason),
        );
    } finally {
      if (mounted.current) setOccurrenceAction(false);
    }
  }

  async function runTimeAction(action: () => Promise<unknown>) {
    if (timeAction) return;
    setTimeAction(true);
    setTimeError(null);
    try {
      if (dirty) await persist(draft, editVersion.current);
      await action();
    } catch (reason) {
      if (mounted.current)
        setTimeError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (mounted.current) setTimeAction(false);
    }
  }

  return (
    <section className="screen task-screen" aria-label="Task details">
      <header className="task-toolbar">
        <button
          aria-label="Back"
          className="icon-action"
          disabled={leaving}
          type="button"
          onClick={() => void leave()}
        >
          <ArrowLeft aria-hidden="true" size={21} strokeWidth={1.7} />
        </button>
        <button
          className={`save-state is-${saveState}`}
          disabled={saveState !== "error" || !draft.title.trim()}
          type="button"
          onClick={() =>
            void persist(draft, editVersion.current).catch(() => undefined)
          }
          aria-label={
            saveState === "error"
              ? `Save failed. ${saveError ?? "Tap to retry."}`
              : undefined
          }
        >
          {!draft.title.trim()
            ? "Title required"
            : saveState === "saving"
              ? "Saving"
              : saveState === "error"
                ? "Save failed · Retry"
                : "Saved"}
        </button>
        <TaskActions
          beforeAction={flushBeforeAttachmentMutation}
          context="detail"
          occurrenceDate={occurrenceDate}
          task={task}
          onArchived={onBack}
          onDeleted={onBack}
          onToggle={async () => {
            if (occurrenceDate || task.occurrenceDate) await toggleOccurrence();
            else await toggleTask(task.id);
          }}
        />
      </header>

      {(occurrenceDate && task.recurrence) || task.occurrenceDate ? (
        <div className="occurrence-banner">
          <div>
            <span>
              {task.occurrenceDate ? "Occurrence note" : "Occurrence"}
            </span>
            <strong>
              {formatOccurrenceDate(task.occurrenceDate ?? occurrenceDate!)}
            </strong>
          </div>
          <div className="occurrence-actions">
            <button
              className="text-action"
              disabled={occurrenceAction}
              type="button"
              onClick={() => void toggleOccurrence()}
            >
              {task.occurrenceDate
                ? task.completed
                  ? "Mark open"
                  : "Complete"
                : task.completeInstances.includes(occurrenceDate!)
                  ? "Mark open"
                  : "Complete"}
            </button>
            <button
              className="text-action"
              disabled={occurrenceAction}
              type="button"
              onClick={() => void toggleSkippedOccurrence()}
            >
              {task.occurrenceDate
                ? task.skipped
                  ? "Unskip"
                  : "Skip"
                : task.skippedInstances.includes(occurrenceDate!)
                  ? "Unskip"
                  : "Skip"}
            </button>
            {occurrenceDate && task.recurrence ? (
              <button
                className="text-action"
                disabled={occurrenceAction}
                type="button"
                onClick={() => void materialize()}
              >
                Make occurrence note
              </button>
            ) : null}
          </div>
          {occurrenceError ? (
            <p className="inline-error" role="alert">
              {occurrenceError}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="task-form">
        <label
          className="visually-hidden"
          id="task-title-label"
          htmlFor="task-title"
        >
          Task title
        </label>
        <textarea
          className="title-field"
          id="task-title"
          ref={titleRef}
          rows={2}
          value={draft.title}
          onChange={(event) => change({ title: event.target.value })}
        />

        <div className="field-grid timing-fields task-core-fields">
          <div className="tasknotes-status-field">
            <TaskNotesSelectField
              ariaDescribedBy={
                task.occurrenceDate ? "occurrence-status-help" : undefined
              }
              disabled={Boolean(task.occurrenceDate)}
              label="Status"
              options={[...configuration.statuses].sort(
                (left, right) => left.order - right.order,
              )}
              value={draft.status}
              onChange={(status) => change({ status })}
            />
            {task.occurrenceDate ? (
              <small id="occurrence-status-help">
                Use the occurrence actions above to change this state.
              </small>
            ) : null}
          </div>
          <DateTimeField
            label="Scheduled"
            value={draft.scheduled}
            onChange={(scheduled) => change({ scheduled })}
          />
          <DateTimeField
            label="Due"
            value={draft.due}
            onChange={(due) => change({ due })}
          />
        </div>

        <section className="notes-field">
          <header className="notes-field-heading">
            <h2 id="task-notes-title">Notes</h2>
            <div aria-label="Editor mode" role="group">
              <button
                aria-pressed={notesMode === "write"}
                type="button"
                onClick={() => setNotesMode("write")}
              >
                Write
              </button>
              <button
                aria-pressed={notesMode === "preview"}
                type="button"
                onClick={() => setNotesMode("preview")}
              >
                Preview
              </button>
            </div>
          </header>
          {notesMode === "write" ? (
            <textarea
              aria-labelledby="task-notes-title"
              placeholder="Add Markdown notes"
              rows={8}
              value={draft.body}
              onChange={(event) => change({ body: event.target.value })}
            />
          ) : (
            <Suspense
              fallback={<p className="markdown-preview-empty">Rendering…</p>}
            >
              <MarkdownPreview
                resolveImage={resolveTaskImage}
                source={draft.body}
              />
            </Suspense>
          )}
        </section>

        {repository.files ? (
          <TaskAttachments
            beforeMutation={flushBeforeAttachmentMutation}
            onInsertInline={insertAttachmentInline}
            service={attachmentService}
            store={repository.files}
            task={task}
          />
        ) : null}

        <TaskFormSection summary={organizeSummary(draft)} title="Organize">
          <Fieldset legend="Priority">
            {configuration.priorities.map((priority) => (
              <Choice
                color={priority.color}
                key={priority.value}
                selected={draft.priority === priority.value}
                onClick={() => change({ priority: priority.value })}
              >
                {priority.label}
              </Choice>
            ))}
          </Fieldset>
          <div className="field-grid metadata-fields">
            <ListField
              field={configuration.fieldMapping.projects}
              label="Projects"
              placeholder="Website, Home"
              values={draft.projects}
              valueLabels={projectLabels}
              completion={
                configuration.fieldCompletions[
                  configuration.fieldMapping.projects
                ] ?? { kind: "records" }
              }
              completeField={completeField}
              onChange={(projects) => change({ projects })}
            />
            <ListField
              field={configuration.fieldMapping.contexts}
              label="Contexts"
              placeholder="Computer, Errands"
              values={draft.contexts}
              completion={
                configuration.fieldCompletions[
                  configuration.fieldMapping.contexts
                ] ?? { kind: "values" }
              }
              completeField={completeField}
              onChange={(contexts) => change({ contexts })}
            />
            <ListField
              field="tags"
              label="Tags"
              placeholder="work, important"
              values={draft.tags.filter((tag) => tag !== "task")}
              completion={
                configuration.fieldCompletions.tags ?? { kind: "values" }
              }
              completeField={completeField}
              onChange={(tags) => change({ tags: ["task", ...tags] })}
            />
          </div>
          <DependencyEditor
            completeField={completeDependencyField}
            dependencies={draft.blockedBy}
            field={configuration.fieldMapping.blockedBy}
            labels={
              new Map(
                relationships.blockedBy.flatMap(({ dependency, task }) =>
                  task ? [[dependency.uid, task.title] as const] : [],
                ),
              )
            }
            onChange={(blockedBy) => change({ blockedBy })}
          />
          <RelatedWork relationships={relationships} />
          {configuration.userFields.length ? (
            <section
              className="custom-fields"
              aria-labelledby="custom-fields-title"
            >
              <h2 id="custom-fields-title">Properties</h2>
              <div className="field-grid metadata-fields">
                {configuration.userFields.map((field) => (
                  <CustomField
                    completion={configuration.fieldCompletions[field.key]}
                    completeField={completeField}
                    field={field}
                    key={field.key}
                    value={draft.customProperties[field.key]}
                    onChange={(value) => changeCustomProperty(field.key, value)}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </TaskFormSection>

        <TaskFormSection
          defaultOpen={Boolean(activeTimeEntry(task.timeEntries))}
          summary={timeSummary(task, draft.timeEstimate)}
          title="Time"
        >
          <label className="form-field time-estimate-field">
            <span>Estimate (minutes)</span>
            <input
              inputMode="numeric"
              min="0"
              type="number"
              value={draft.timeEstimate ?? ""}
              onChange={(event) =>
                change({
                  timeEstimate: event.target.value
                    ? Number(event.target.value)
                    : undefined,
                })
              }
            />
          </label>
          <TimeTrackingField
            busy={timeAction}
            entries={task.timeEntries}
            error={timeError}
            onRemove={(index) =>
              runTimeAction(() => removeTimeEntry(task.id, index))
            }
            onReplace={(entries) =>
              runTimeAction(() => replaceTimeEntries(task.id, entries))
            }
            onStart={(description) =>
              runTimeAction(() => startTimeTracking(task.id, description))
            }
            onStop={() => runTimeAction(() => stopTimeTracking(task.id))}
          />
        </TaskFormSection>

        <TaskFormSection
          summary={repeatSummary(draft)}
          title="Repeat and reminders"
        >
          <RecurrenceField
            anchor={draft.recurrenceAnchor}
            scheduled={draft.scheduled}
            value={draft.recurrence}
            onAnchorChange={(recurrenceAnchor) => change({ recurrenceAnchor })}
            onChange={(recurrence) => change({ recurrence })}
          />
          {draft.recurrence && !task.occurrenceDate ? (
            <OccurrencePolicyField
              futureHorizon={draft.occurrenceFutureHorizon}
              materialization={draft.occurrenceMaterialization ?? "manual"}
              nextTrigger={draft.occurrenceNextTrigger ?? "completion"}
              pastHorizon={draft.occurrencePastHorizon}
              template={draft.occurrenceTemplate}
              onChange={(patch) => change(patch)}
            />
          ) : null}
          <ReminderEditor
            deliveryMode="mdbase"
            due={draft.due}
            reminders={draft.reminders}
            scheduled={draft.scheduled}
            onChange={(reminders) => change({ reminders })}
          />
        </TaskFormSection>

        <details className="record-path">
          <summary>Markdown record</summary>
          <code>{task.path}</code>
        </details>
      </div>
    </section>
  );
}

function OccurrencePolicyField({
  materialization,
  nextTrigger,
  template,
  pastHorizon,
  futureHorizon,
  onChange,
}: {
  materialization: "manual" | "on_completion" | "rolling";
  nextTrigger: "completion" | "completion_or_skip";
  template?: string;
  pastHorizon?: string;
  futureHorizon?: string;
  onChange(value: Partial<Draft>): void;
}) {
  return (
    <section className="repeat-fields occurrence-policy">
      <div className="repeat-heading">
        <div>
          <span className="field-label">Occurrence notes</span>
          <p>Keep individual Markdown notes for recurring dates.</p>
        </div>
        <TaskNotesSelect
          ariaLabel="Occurrence note policy"
          options={[
            { value: "manual", label: "When I choose" },
            {
              value: "on_completion",
              label: "Create the next after completion",
            },
            { value: "rolling", label: "Keep a rolling window" },
          ]}
          value={materialization}
          onChange={(value) =>
            onChange({
              occurrenceMaterialization:
                value as Task["occurrenceMaterialization"],
            })
          }
        />
      </div>
      {materialization === "on_completion" ? (
        <TaskNotesSelectField
          label="Advance after"
          options={[
            { value: "completion", label: "Completion" },
            {
              value: "completion_or_skip",
              label: "Completion or skip",
            },
          ]}
          value={nextTrigger}
          onChange={(value) =>
            onChange({
              occurrenceNextTrigger: value as Task["occurrenceNextTrigger"],
            })
          }
        />
      ) : null}
      {materialization === "rolling" ? (
        <div className="field-grid metadata-fields">
          <label className="form-field">
            <span>Past horizon</span>
            <input
              placeholder="P0D"
              value={pastHorizon ?? ""}
              onChange={(event) =>
                onChange({ occurrencePastHorizon: event.target.value })
              }
            />
          </label>
          <label className="form-field">
            <span>Future horizon</span>
            <input
              placeholder="P14D"
              value={futureHorizon ?? ""}
              onChange={(event) =>
                onChange({ occurrenceFutureHorizon: event.target.value })
              }
            />
          </label>
        </div>
      ) : null}
      <label className="form-field">
        <span>Occurrence template</span>
        <input
          placeholder="Templates/Occurrence.md"
          value={template ?? ""}
          onChange={(event) =>
            onChange({ occurrenceTemplate: event.target.value })
          }
        />
      </label>
    </section>
  );
}

function formatOccurrenceDate(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
}

function DateTimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: string;
  onChange(value?: string): void;
}) {
  return (
    <TaskNotesDateTimeField
      combineValue={combineTaskDateTime}
      label={label}
      splitValue={(current) => ({
        date: taskDatePart(current) || undefined,
        time: taskTimePart(current) || undefined,
      })}
      value={value}
      onChange={onChange}
    />
  );
}

function CustomField({
  field,
  value,
  completion,
  completeField,
  onChange,
}: {
  field: TaskUserMappedField;
  value: unknown;
  completion?: TaskFieldCompletionConfiguration;
  completeField(request: FieldCompletionRequest): Promise<FieldCompletion[]>;
  onChange(value: unknown): void;
}) {
  const label = `${field.displayName}${field.required ? " *" : ""}`;
  if (field.inputKind === "enum") {
    const options = (
      field.options ??
      (completion?.kind === "values" ? completion.values : []) ??
      []
    ).map((option) => ({
      value: option.value,
      label: option.label ?? option.value,
    }));
    return (
      <TaskNotesSelectField
        disabled={field.readOnly}
        label={label}
        options={options}
        placeholder={field.required ? "Choose a value" : "No value"}
        value={typeof value === "string" ? value : ""}
        onChange={onChange}
      />
    );
  }
  if (field.inputKind === "datetime") {
    return (
      <TaskNotesDateTimeField
        combineValue={combineSchemaDateTime}
        disabled={field.readOnly}
        label={label}
        splitValue={splitSchemaDateTime}
        value={typeof value === "string" ? value : undefined}
        onChange={onChange}
      />
    );
  }
  if (field.type === "boolean") {
    return (
      <label className="form-field boolean-field">
        <span>{label}</span>
        <input
          checked={value === true}
          disabled={field.readOnly}
          required={field.required}
          type="checkbox"
          onChange={(event) => onChange(event.target.checked)}
        />
      </label>
    );
  }
  if (field.type === "list") {
    if (field.readOnly)
      return (
        <label className="form-field">
          <span>{label}</span>
          <input
            readOnly
            value={Array.isArray(value) ? value.map(String).join(", ") : ""}
          />
        </label>
      );
    return (
      <ListField
        field={field.key}
        label={label}
        placeholder="Comma-separated values"
        values={Array.isArray(value) ? value.map(String) : []}
        completion={completion ?? { kind: "values" }}
        completeField={completeField}
        onChange={onChange}
      />
    );
  }
  if (field.type === "date") {
    return (
      <TaskNotesDateField
        disabled={field.readOnly}
        label={label}
        value={typeof value === "string" ? value : undefined}
        onChange={onChange}
      />
    );
  }
  return (
    <label className="form-field">
      <span>{label}</span>
      <input
        inputMode={field.type === "number" ? "decimal" : undefined}
        readOnly={field.readOnly}
        required={field.required}
        type={field.type === "number" ? "number" : "text"}
        value={
          typeof value === "string" || typeof value === "number" ? value : ""
        }
        onChange={(event) =>
          onChange(
            field.type === "number" && event.target.value
              ? Number(event.target.value)
              : event.target.value,
          )
        }
      />
    </label>
  );
}

function splitSchemaDateTime(value?: string): {
  date?: string;
  time?: string;
} {
  const local = toLocalDateTime(value);
  if (!local) return {};
  const [date, time] = local.split("T");
  return { date, time };
}

function combineSchemaDateTime(
  date?: string,
  time?: string,
): string | undefined {
  if (!date) return undefined;
  const parsed = new Date(`${date}T${time ?? "00:00"}:00`);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed.toISOString();
}

function toLocalDateTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  const local = new Date(date.valueOf() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
