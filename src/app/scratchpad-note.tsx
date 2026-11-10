import { t as translate } from "@lingui/core/macro";
import { plural } from "@lingui/core/macro";
import { useLingui, Trans } from "@lingui/react/macro";
import {
  Check,
  ChevronDown,
  CircleAlert,
  FileCheck2,
  ListChecks,
  MoreHorizontal,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import {
  undoScratchpadConversion,
  type ScratchpadConversion,
} from "../application/scratchpad-conversion";
import { useOverlay } from "../components/overlays/use-overlay";
import { RecordWriteNotice } from "../components/record-write-notice";
import { useRecordWriteState } from "../components/use-record-write-state";
import { captureTriggers } from "../domain/capture-autosuggest";
import { recordCompletion, recordMatchesLink } from "../domain/completion";
import {
  ensureOutlineContinuation,
  linkOutlineLine,
  noteBodyToEdit,
  noteBodyToSave,
  outlineItems,
  outlineNodes,
  outlineTaskKey,
  restoreOutlineDraft,
} from "../domain/scratch-outline";
import {
  nearestTaskAncestor,
  scratchSubtreeEnd,
  scratchpadHistoryDate,
  type ScratchNode,
  type ScratchpadDocument,
} from "../domain/scratchpad";
import {
  parseTaskCapture,
  preloadTaskCapture,
  type TaskCaptureResult,
} from "../domain/task-capture";
import { markedPriorityColorOf } from "../domain/task-configuration";
import { nestedItemCount } from "../i18n/default-labels";
import { formatTaskDate } from "../i18n/presentation";
import { uiCopy } from "../i18n/ui-copy";
import { successFeedback } from "../native/feedback";
import { registerReloadParticipant } from "../pwa/reload";
import { useRepository } from "./repository-context";
import { formatScratchDate, message } from "./scratchpad-format";
import {
  useMenuDirection,
  usePhoneNoteLine,
  useScratchpadMenu,
} from "./use-scratchpad-menu";

import type { TaskCreateIntent } from "../application/ports/task-repository";
import type {
  OutlinePreview,
  OutlineTaskView,
} from "../components/scratch-outline-extension";
import type {
  ScratchCaretLine,
  ScratchpadNoteEditorActions,
  ScratchpadNoteEditorHandle,
} from "../components/scratchpad-note-editor";
import type { FieldCompletionRequest } from "../domain/completion";
import type { TaskSummary } from "../domain/task";

const ScratchpadNoteEditor = lazy(async () => ({
  default: (await import("../components/scratchpad-note-editor"))
    .ScratchpadNoteEditor,
}));

interface ReviewItem {
  id: string;
  text: string;
  depth: number;
}

interface ReviewResult {
  state: "creating" | "created" | "error";
  message?: string;
  task?: TaskSummary;
}

interface ScratchpadNotice {
  message: string;
  tasks?: TaskSummary[];
  conversions?: ScratchpadConversion[];
}

const ALL_TASKS = {
  status: "all",
  archived: "include",
  limit: 50_000,
} as const;

/** A note with nothing in it opens on an empty task, ready for typing. */
function editorText(body: string): string {
  return noteBodyToEdit(body) || "- [ ] ";
}

function lineNumber(id: string): number {
  return Number(id.slice("line-".length));
}

/**
 * One scratchpad note: its title or date, and its text. The text is Markdown
 * in one editor; a line with a checkbox is a draft that can become a task.
 */
export function ScratchpadNote({
  onOpenTask,
  onReactivate,
  onCollapse,
  onDelete,
  initialDocument,
  isCurrent,
  reactivating,
  reactivationDisabled,
  registerFlusher,
  onDocumentUpdated,
}: {
  onOpenTask(task: TaskSummary): void;
  onReactivate?: () => void;
  /** An earlier note can be folded back into its row. */
  onCollapse?: () => void;
  onDelete?: () => void;
  initialDocument: ScratchpadDocument;
  isCurrent: boolean;
  reactivating: boolean;
  reactivationDisabled: boolean;
  registerFlusher(flush: (() => Promise<unknown>) | null): void;
  onDocumentUpdated(document: ScratchpadDocument): void;
}) {
  const { t } = useLingui();
  const { repository, configuration, createTask, updateTask } = useRepository();
  const phoneLine = usePhoneNoteLine();
  const createIntents = useRef(new Map<string, TaskCreateIntent>());
  const [document, setDocument] = useState<ScratchpadDocument | null>(null);
  const [linkedTasks, setLinkedTasks] = useState<Map<string, TaskSummary>>(
    new Map(),
  );
  const nativeSaveState = useRecordWriteState(repository, {
    kind: "scratchpad",
    id: document?.id ?? initialDocument.id,
  });
  const [source, setSource] = useState(() => editorText(initialDocument.body));
  const [title, setTitle] = useState(initialDocument.title ?? "");
  const [titleFocused, setTitleFocused] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">(
    "saved",
  );
  const [caretLine, setCaretLine] = useState<ScratchCaretLine | null>(null);
  const [preview, setPreview] = useState<OutlinePreview | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const reviewRef = useRef<HTMLElement | null>(null);
  const reviewCloseRef = useRef<HTMLButtonElement | null>(null);
  const reviewTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [selectedReviewIds, setSelectedReviewIds] = useState<Set<string>>(
    new Set(),
  );
  const [reviewResults, setReviewResults] = useState<
    Record<string, ReviewResult>
  >({});
  const [reviewProcessing, setReviewProcessing] = useState(false);
  useOverlay({
    open: reviewOpen,
    rootRef: reviewRef,
    modal: true,
    returnFocusRef: reviewTriggerRef,
    initialFocus: () => reviewCloseRef.current,
    onDismiss: () => {
      if (!reviewProcessing) setReviewOpen(false);
    },
  });
  const [converting, setConverting] = useState(false);
  const [notice, setNotice] = useState<ScratchpadNotice | null>(null);
  const [undoingConversion, setUndoingConversion] = useState(false);
  const initialDocumentRef = useRef(initialDocument);
  const documentRef = useRef<ScratchpadDocument | null>(null);
  const editorRef = useRef<ScratchpadNoteEditorHandle | null>(null);
  const sourceRef = useRef(source);
  const sourceEditVersion = useRef(0);
  const titleRef = useRef(initialDocument.title ?? "");
  const linkedTasksRef = useRef(linkedTasks);
  /** Links already looked up that turned out not to be tasks. */
  const plainLinks = useRef(new Set<string>());
  const saveTail = useRef<Promise<unknown>>(Promise.resolve());
  const savesInFlight = useRef(0);
  /** Advances whenever this note adopts a saved or incoming version. */
  const documentVersion = useRef(0);
  const autosaveSuspended = useRef(false);

  useEffect(() => {
    const timeout = window.setTimeout(preloadTaskCapture, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  const changeLinkedTasks = useCallback(
    (
      change: (current: Map<string, TaskSummary>) => Map<string, TaskSummary>,
    ) => {
      linkedTasksRef.current = change(linkedTasksRef.current);
      setLinkedTasks(linkedTasksRef.current);
    },
    [],
  );

  const taskForLink = useCallback((link: string) => {
    const key = outlineTaskKey(link);
    for (const task of linkedTasksRef.current.values())
      if (outlineTaskKey(task.path) === key) return task;
  }, []);

  /** The tasks that lines of `text` link to, by task id. */
  const tasksLinkedIn = useCallback(
    async (text: string) => {
      const links = new Set(
        outlineItems(text).flatMap((item) =>
          item.link ? [outlineTaskKey(item.link)] : [],
        ),
      );
      const linked = new Map<string, TaskSummary>();
      if (!links.size) return linked;
      for (const task of await repository.listSummaries(ALL_TASKS)) {
        const key = outlineTaskKey(task.path);
        if (!links.has(key)) continue;
        linked.set(task.id, task);
        links.delete(key);
      }
      for (const link of links) plainLinks.current.add(link);
      return linked;
    },
    [repository],
  );

  const changeSource = useCallback((next: string) => {
    sourceEditVersion.current += 1;
    sourceRef.current = next;
    setSource(next);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = initialDocumentRef.current;
      const text = editorText(next.body);
      const tasks = await tasksLinkedIn(text);
      documentRef.current = next;
      sourceRef.current = text;
      titleRef.current = next.title ?? "";
      changeLinkedTasks(() => tasks);
      setDocument(next);
      setSource(text);
      editorRef.current?.setText(text);
      setTitle(next.title ?? "");
      setSaveState("saved");
    } catch (reason) {
      setError(message(reason));
    } finally {
      setLoading(false);
    }
  }, [changeLinkedTasks, tasksLinkedIn]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  const persistBody = useCallback(
    (body: string, nextTitle = titleRef.current) => {
      const current = documentRef.current;
      if (!current || !repository.saveScratchpad)
        return Promise.reject(
          new Error(t({ message: "Scratchpad storage is unavailable." })),
        );
      const normalizedTitle = nextTitle.trim();
      setSaveState("saving");
      savesInFlight.current += 1;
      const operation = saveTail.current
        .catch(() => undefined)
        .then(async () => {
          const latest = documentRef.current;
          if (!latest)
            throw new Error(t({ message: "The scratchpad is not open." }));
          if (
            body === latest.body &&
            normalizedTitle === (latest.title?.trim() ?? "")
          ) {
            setSaveState("saved");
            return latest;
          }
          const saved = await repository.saveScratchpad!({
            id: latest.id,
            path: latest.path,
            revision: latest.revision,
            baseBody: latest.body,
            body,
            title: normalizedTitle,
          });
          documentRef.current = saved;
          documentVersion.current += 1;
          if (titleRef.current === nextTitle) {
            titleRef.current = saved.title ?? "";
            setTitle(saved.title ?? "");
          }
          setDocument(saved);
          onDocumentUpdated(saved);
          setError("");
          setSaveState("saved");
          return saved;
        })
        .catch((reason) => {
          setSaveState("error");
          setError(message(reason));
          throw reason;
        })
        .finally(() => {
          savesInFlight.current -= 1;
        });
      saveTail.current = operation;
      return operation;
    },
    [onDocumentUpdated, repository, t],
  );

  /** The text in the editor, as it would be saved over the current version. */
  const bodyToSave = useCallback(
    () => noteBodyToSave(sourceRef.current, documentRef.current?.body ?? ""),
    [],
  );

  // A change saved elsewhere (another tab or device) is shown only while this
  // note has no unsaved or saving edit. An edit in progress is kept and saved
  // against the version it started from, so the collection reports the
  // conflict instead of either side being silently overwritten.
  const onDocumentUpdatedRef = useRef(onDocumentUpdated);
  useEffect(() => {
    onDocumentUpdatedRef.current = onDocumentUpdated;
  }, [onDocumentUpdated]);

  useEffect(() => {
    const getScratchpad = repository.getScratchpad?.bind(repository);
    if (!getScratchpad) return;
    let live = true;
    let latestRequest = 0;
    const unchangedLocally = (current: ScratchpadDocument) =>
      savesInFlight.current === 0 &&
      !autosaveSuspended.current &&
      titleRef.current.trim() === (current.title?.trim() ?? "") &&
      noteBodyToSave(sourceRef.current, current.body) === current.body;
    const refresh = async () => {
      const current = documentRef.current;
      if (!current) return;
      const request = ++latestRequest;
      const version = documentVersion.current;
      const sourceVersion = sourceEditVersion.current;
      const incoming = await getScratchpad(current.id).catch(() => null);
      const stillCurrent = () =>
        live &&
        request === latestRequest &&
        version === documentVersion.current &&
        sourceVersion === sourceEditVersion.current &&
        documentRef.current === current;
      if (
        !incoming ||
        !stillCurrent() ||
        incoming.id !== current.id ||
        incoming.revision === current.revision ||
        // Starting, resuming and deleting notes are applied by the stream.
        incoming.state !== current.state ||
        !unchangedLocally(current)
      )
        return;
      let tasks: Map<string, TaskSummary> | undefined;
      if (incoming.body !== current.body) {
        tasks = await tasksLinkedIn(editorText(incoming.body)).catch(
          () => undefined,
        );
        if (!tasks || !stillCurrent() || !unchangedLocally(current)) return;
      }
      documentRef.current = incoming;
      documentVersion.current += 1;
      titleRef.current = incoming.title ?? "";
      setTitle(incoming.title ?? "");
      if (tasks) {
        const text = editorText(incoming.body);
        const linked = tasks;
        changeLinkedTasks(() => linked);
        sourceRef.current = text;
        setSource(text);
        editorRef.current?.setText(text);
      }
      setDocument(incoming);
      onDocumentUpdatedRef.current(incoming);
    };
    const stop = repository.subscribe((change) => {
      if (!change || change.kind === "data") void refresh();
    });
    return () => {
      live = false;
      stop();
    };
  }, [changeLinkedTasks, repository, tasksLinkedIn]);

  useEffect(() => {
    let live = true;
    let latestRequest = 0;
    const refreshLinkedTasks = async () => {
      const documentId = documentRef.current?.id;
      const request = ++latestRequest;
      const ids = [...linkedTasksRef.current.keys()];
      if (!ids.length) return;
      const tasks = await Promise.all(
        ids.map((id) => repository.getSummary(id).catch(() => null)),
      );
      if (
        !live ||
        request !== latestRequest ||
        documentRef.current?.id !== documentId
      )
        return;
      changeLinkedTasks((current) => {
        const next = new Map(current);
        for (const task of tasks) if (task) next.set(task.id, task);
        return next;
      });
    };
    const stop = repository.subscribe((change) => {
      if (!change || change.kind === "data") void refreshLinkedTasks();
    });
    return () => {
      live = false;
      stop();
    };
  }, [changeLinkedTasks, repository]);

  // A link typed by hand is looked up once, so a line that names a task reads
  // as that task without waiting for the note to be opened again.
  const unknownLinks = useMemo(
    () =>
      [
        ...new Set(
          outlineItems(source).flatMap((item) =>
            item.link ? [outlineTaskKey(item.link)] : [],
          ),
        ),
      ]
        .filter(
          (key) =>
            !plainLinks.current.has(key) &&
            ![...linkedTasks.values()].some(
              (task) => outlineTaskKey(task.path) === key,
            ),
        )
        .join("\n"),
    [linkedTasks, source],
  );

  useEffect(() => {
    if (!unknownLinks || loading) return;
    let live = true;
    const timeout = window.setTimeout(() => {
      void tasksLinkedIn(sourceRef.current).then(
        (found) => {
          if (!live || !found.size) return;
          changeLinkedTasks((current) => new Map([...current, ...found]));
        },
        () => undefined,
      );
    }, 400);
    return () => {
      live = false;
      window.clearTimeout(timeout);
    };
  }, [changeLinkedTasks, loading, tasksLinkedIn, unknownLinks]);

  const completeRecords = useCallback(
    (request: FieldCompletionRequest) => repository.completeField(request),
    [repository],
  );
  const capture = useMemo(
    () => ({
      configuration,
      triggers: captureTriggers(configuration),
      complete: completeRecords,
    }),
    [completeRecords, configuration],
  );

  const flush = useCallback(
    () =>
      documentRef.current
        ? persistBody(bodyToSave())
        : Promise.resolve(initialDocumentRef.current),
    [bodyToSave, persistBody],
  );

  useEffect(
    () =>
      registerReloadParticipant({
        save: async () => {
          if (reviewProcessing || converting || autosaveSuspended.current)
            throw new Error(
              translate({
                message: "Finish the note action in progress before reloading.",
              }),
            );
          const version = sourceEditVersion.current;
          await flush();
          if (version !== sourceEditVersion.current)
            throw new Error(
              translate({
                message:
                  "Your note changed while saving. Save it again before reloading.",
              }),
            );
        },
        check: () => {
          const current = documentRef.current;
          if (!current) return;
          if (
            bodyToSave() !== current.body ||
            titleRef.current.trim() !== (current.title?.trim() ?? "") ||
            repository.writeState?.({ kind: "scratchpad", id: current.id })
          )
            throw new Error(
              translate({
                message:
                  "Some note changes are not saved. Keep this page open and try again.",
              }),
            );
        },
      }),
    [bodyToSave, converting, flush, repository, reviewProcessing],
  );

  useEffect(() => {
    registerFlusher(flush);
    return () => registerFlusher(null);
  }, [flush, registerFlusher]);

  useEffect(() => {
    if (
      !document ||
      reviewProcessing ||
      converting ||
      autosaveSuspended.current ||
      noteBodyToSave(source, documentRef.current?.body ?? "") ===
        documentRef.current?.body
    )
      return;
    const timeout = window.setTimeout(() => {
      if (!autosaveSuspended.current)
        void persistBody(bodyToSave()).catch(() => undefined);
    }, 260);
    return () => window.clearTimeout(timeout);
  }, [bodyToSave, converting, document, persistBody, reviewProcessing, source]);

  useEffect(() => {
    if (
      !document ||
      autosaveSuspended.current ||
      title.trim() === (documentRef.current?.title?.trim() ?? "")
    )
      return;
    const timeout = window.setTimeout(() => {
      if (!autosaveSuspended.current)
        void persistBody(bodyToSave(), title).catch(() => undefined);
    }, 260);
    return () => window.clearTimeout(timeout);
  }, [bodyToSave, document, persistBody, title]);

  // What the draft at the caret would become: its date, priority and so on.
  const previewLine = caretLine?.kind === "draft" ? caretLine.line : undefined;
  const previewText = caretLine?.kind === "draft" ? caretLine.text : "";
  useEffect(() => {
    if (previewLine === undefined || !previewText.trim()) return;
    let active = true;
    const timeout = window.setTimeout(() => {
      void parseTaskCapture(previewText, configuration).then(
        (result) => {
          if (active)
            setPreview({
              line: previewLine,
              text: previewText,
              details: result.preview.map(({ label }) => label),
            });
        },
        () => {
          if (active) setPreview(null);
        },
      );
    }, 90);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [configuration, previewLine, previewText]);

  const taskViews = useMemo(() => {
    const views = new Map<string, OutlineTaskView>();
    for (const task of linkedTasks.values()) {
      const date = task.scheduled || task.due;
      // The usual priority says nothing; only one that was chosen is shown.
      const priority =
        task.priority &&
        task.priority !== configuration.defaults.priority &&
        task.priority !== "none"
          ? (configuration.priorities.find(
              ({ value }) => value === task.priority,
            )?.label ?? task.priority)
          : undefined;
      views.set(outlineTaskKey(task.path), {
        title: task.title,
        completed: task.completed,
        details: [
          ...(date ? [formatTaskDate(date)] : []),
          ...(priority ? [priority] : []),
        ],
        color: markedPriorityColorOf(task.priority, configuration),
      });
    }
    return views;
  }, [configuration, linkedTasks]);

  /** The note's list items as they stand, with linked tasks resolved. */
  function currentOutline() {
    const items = outlineItems(sourceRef.current);
    const nodes = outlineNodes(items, (link) => {
      const task = taskForLink(link);
      return task ? { id: task.id, title: task.title } : undefined;
    });
    return { items, nodes };
  }

  function applyText(next: string, caret?: number) {
    if (editorRef.current) editorRef.current.replaceText(next, caret);
    else changeSource(next);
  }

  async function convertLine(line: number) {
    if (converting || reviewProcessing) return;
    autosaveSuspended.current = true;
    setConverting(true);
    setError("");
    try {
      const id = `line-${line}`;
      const converted = await createTaskForNode(id, true);
      await persistBody(bodyToSave());
      const after = currentOutline().nodes;
      const children = await linkExistingChildren(after, id, converted.task);
      successFeedback();
      setNotice({
        message: t`Created “${converted.task.title}”`,
        tasks: [converted.task],
        conversions: [
          {
            draft: converted.draft,
            linked: after.find((node) => node.id === id)!,
            task: converted.task,
            children,
          },
        ],
      });
    } catch (reason) {
      setError(message(reason));
    } finally {
      autosaveSuspended.current = false;
      setConverting(false);
    }
  }

  /** Creates the task for a draft line and puts its link on that line. */
  async function createTaskForNode(id: string, continueWriting: boolean) {
    const { items, nodes } = currentOutline();
    const index = nodes.findIndex((node) => node.id === id);
    const node = nodes[index];
    const item = items[index];
    if (!node || !item || node.kind !== "draft")
      throw new Error(t({ message: "Only draft items can become TaskNotes." }));
    if (!node.text.trim())
      throw new Error(t({ message: "Add a task title first." }));
    const result: TaskCaptureResult = await parseTaskCapture(
      node.text,
      configuration,
    ).catch(() => ({
      input: { title: node.text.trim() },
      preview: [],
    }));
    const parent = nearestTaskAncestor(nodes, index);
    const projects = [
      ...(result.input.projects ?? []),
      ...(parent?.link ? [parent.link] : []),
    ].filter((value, candidate, values) => values.indexOf(value) === candidate);
    const completedStatus = node.completed
      ? configuration.statuses.find((status) => status.isCompleted)
      : undefined;
    if (node.completed && !completedStatus)
      throw new Error(
        t({
          message: "This collection does not define a completed task status.",
        }),
      );
    const createInput = {
      ...result.input,
      ...(projects.length ? { projects } : {}),
      ...(completedStatus ? { status: completedStatus.value } : {}),
    };
    // The same draft tried again asks for the same task, not a second one.
    const draftKey = `${item.line}\n${sourceRef.current.slice(item.from, item.to)}`;
    let intent = createIntents.current.get(draftKey);
    if (!intent) {
      intent = { id: crypto.randomUUID() };
      createIntents.current.set(draftKey, intent);
    }
    const task = await createTask(createInput, intent);
    changeLinkedTasks((current) => new Map(current).set(task.id, task));
    const link = recordCompletion(
      {
        path: task.path,
        label: task.title,
        frontmatter: task.frontmatter,
        types: ["task"],
      },
      configuration.linkWriteFormat,
    ).value;
    const still = outlineItems(sourceRef.current).find(
      (entry) => entry.line === item.line,
    );
    if (!still || still.text !== item.text || still.checked === undefined)
      throw new Error(
        t({ message: "This draft is no longer in the scratchpad." }),
      );
    const linked = linkOutlineLine(sourceRef.current, item.line, link);
    createIntents.current.delete(draftKey);
    if (continueWriting) {
      const next = ensureOutlineContinuation(linked, item.line);
      applyText(next.source, next.caret);
    } else applyText(linked);
    return { task, draft: node };
  }

  async function linkExistingChildren(
    nodes: ScratchNode[],
    parentId: string,
    parentTask: TaskSummary,
  ) {
    const children: ScratchpadConversion["children"] = [];
    const parentIndex = nodes.findIndex((node) => node.id === parentId);
    if (parentIndex < 0) return children;
    const parentLink = recordCompletion(
      {
        path: parentTask.path,
        label: parentTask.title,
        frontmatter: parentTask.frontmatter,
        types: ["task"],
      },
      configuration.linkWriteFormat,
    ).value;
    for (let index = parentIndex + 1; index < nodes.length; index += 1) {
      const node = nodes[index]!;
      if (node.depth <= nodes[parentIndex]!.depth) break;
      if (
        node.kind !== "task" ||
        nearestTaskAncestor(nodes, index)?.id !== parentId
      )
        continue;
      const task = await resolveLinkedTask(node);
      if (!task || task.projects.some((value) => value === parentLink))
        continue;
      const after = await updateTask(task.id, {
        projects: [...task.projects, parentLink],
      });
      children.push({ before: task, after });
    }
    return children;
  }

  async function resolveLinkedTask(
    node: Pick<ScratchNode, "taskId" | "link">,
  ): Promise<TaskSummary | null> {
    if (node.taskId) {
      const task = await repository.get(node.taskId);
      if (task) return task;
    }
    const tasks = await repository.listSummaries(ALL_TASKS);
    return (
      tasks.find(
        (task) => node.link && recordMatchesLink(task.path, node.link),
      ) ?? null
    );
  }

  async function openLinkedTask(link: string) {
    try {
      const task = await resolveLinkedTask({
        link,
        taskId: taskForLink(link)?.id,
      });
      if (!task)
        throw new Error(
          t({ message: "The linked TaskNote could not be found." }),
        );
      onOpenTask(task);
    } catch (reason) {
      setError(message(reason));
    }
  }

  async function toggleLinkedTask(link: string) {
    const task = taskForLink(link);
    if (!task) return;
    try {
      const updated = await updateTask(task.id, { completed: !task.completed });
      changeLinkedTasks((current) => new Map(current).set(updated.id, updated));
    } catch (reason) {
      setError(message(reason));
    }
  }

  function openReview() {
    const { nodes } = currentOutline();
    const items = nodes
      .filter((node) => node.kind === "draft" && node.text.trim())
      .map(({ id, text, depth }) => ({ id, text, depth }));
    if (!items.length) return;
    if (
      items.length === 1 &&
      nodes.every((node) => node.id === items[0]!.id || !node.text.trim())
    ) {
      void convertLine(lineNumber(items[0]!.id));
      return;
    }
    setReviewItems(items);
    const current = items.find(
      (item) => caretLine && lineNumber(item.id) === caretLine.line,
    );
    setSelectedReviewIds(new Set(current ? [current.id] : []));
    setReviewResults({});
    setReviewOpen(true);
  }

  function toggleReviewBranch(id: string) {
    const { nodes } = currentOutline();
    const index = nodes.findIndex((node) => node.id === id);
    if (index < 0) return;
    const branchIds = nodes
      .slice(index, scratchSubtreeEnd(nodes, index))
      .filter((node) => node.kind === "draft" && node.text.trim())
      .map((node) => node.id);
    setSelectedReviewIds((current) => {
      const next = new Set(current);
      const select = branchIds.some((branchId) => !next.has(branchId));
      for (const branchId of branchIds)
        if (select) next.add(branchId);
        else next.delete(branchId);
      return next;
    });
  }

  async function createReviewedTasks() {
    if (reviewProcessing) return;
    const pending = reviewItems.filter(
      (item) =>
        selectedReviewIds.has(item.id) &&
        reviewResults[item.id]?.state !== "created",
    );
    if (!pending.length) return;
    autosaveSuspended.current = true;
    setReviewProcessing(true);
    setError("");
    const failedIds = new Set<string>();
    const completed = new Map<string, TaskSummary>();
    const conversions: ScratchpadConversion[] = [];
    for (const result of Object.values(reviewResults))
      if (result.state === "created" && result.task)
        completed.set(result.task.id, result.task);

    for (const item of pending) {
      const previous = reviewResults[item.id];
      setReviewResults((current) => ({
        ...current,
        [item.id]: { state: "creating", task: previous?.task },
      }));
      let createdTask = previous?.task;
      let convertedDraft: ScratchNode | undefined;
      try {
        const currentNode = currentOutline().nodes.find(
          (node) => node.id === item.id,
        );
        if (currentNode?.kind === "draft") {
          const converted = await createTaskForNode(item.id, false);
          createdTask = converted.task;
          convertedDraft = converted.draft;
        } else if (currentNode?.kind === "task") {
          createdTask ??= (await resolveLinkedTask(currentNode)) ?? undefined;
        } else {
          throw new Error(
            t({ message: "This draft is no longer in the scratchpad." }),
          );
        }
        if (!createdTask)
          throw new Error(
            t({ message: "The created TaskNote could not be found." }),
          );
        await persistBody(bodyToSave());
        const after = currentOutline().nodes;
        const children = await linkExistingChildren(
          after,
          item.id,
          createdTask,
        );
        if (convertedDraft)
          conversions.push({
            draft: convertedDraft,
            linked: after.find((node) => node.id === item.id)!,
            task: createdTask,
            children,
          });
        completed.set(createdTask.id, createdTask);
        setReviewResults((current) => ({
          ...current,
          [item.id]: { state: "created", task: createdTask! },
        }));
      } catch (reason) {
        failedIds.add(item.id);
        setReviewResults((current) => ({
          ...current,
          [item.id]: {
            state: "error",
            message: message(reason),
            task: createdTask,
          },
        }));
      }
    }

    autosaveSuspended.current = false;
    setReviewProcessing(false);
    if (failedIds.size) {
      setSelectedReviewIds(failedIds);
      return;
    }
    setReviewOpen(false);
    const tasks = [...completed.values()];
    setNotice({
      message: plural(tasks.length, {
        one: "Created # task",
        other: "Created # tasks",
      }),
      tasks,
      conversions,
    });
    successFeedback();
  }

  async function undoConversion() {
    if (!notice?.conversions?.length || undoingConversion) return;
    const conversions = notice.conversions;
    setUndoingConversion(true);
    autosaveSuspended.current = true;
    let changed = false;
    try {
      await flush();
      for (const conversion of [...conversions].reverse()) {
        const link = conversion.linked.link!;
        // Lines above may have been added since; the line is found by its link.
        const result = await undoScratchpadConversion(
          repository,
          conversion,
          () => {
            const { nodes } = currentOutline();
            const index = nodes.findIndex(
              (node) => node.kind === "task" && node.link === link,
            );
            return nodes.map((node, position) =>
              position === index ? { ...node, id: conversion.draft.id } : node,
            );
          },
        );
        const restored =
          result === "restored"
            ? restoreOutlineDraft(sourceRef.current, link, conversion.draft)
            : undefined;
        if (restored === undefined) {
          changed = true;
          continue;
        }
        changeLinkedTasks((current) => {
          const next = new Map(current);
          next.delete(conversion.task.id);
          return next;
        });
        applyText(restored);
        await persistBody(bodyToSave());
      }
      setNotice({
        message: changed
          ? t`Some tasks or notes changed after conversion. They were kept; their drafts were not restored.`
          : t`Conversion undone`,
      });
    } catch (reason) {
      setError(message(reason));
    } finally {
      autosaveSuspended.current = false;
      setUndoingConversion(false);
    }
  }

  const editorActions: ScratchpadNoteEditorActions = {
    createTask: (line) => void convertLine(line),
    openTask: (link) => void openLinkedTask(link),
    toggleTask: (link) => void toggleLinkedTask(link),
    taskLinked: (taskId) =>
      void repository.get(taskId).then((task) => {
        if (task)
          changeLinkedTasks((current) => new Map(current).set(task.id, task));
      }),
    foldLabel: (open, text, nested) =>
      nested
        ? t`${open ? uiCopy("Collapse") : uiCopy("Expand")} ${text || uiCopy("item")}, ${nestedItemCount(nested)}`
        : `${open ? uiCopy("Collapse") : uiCopy("Expand")} ${text}`,
    nestedLabel: (count) => nestedItemCount(count),
    createTaskLabel: (text) => t`Create task for ${text}`,
  };

  if (loading)
    return (
      <section className="scratchpad-editor" aria-busy="true">
        <div className="scratchpad-loading" />
      </section>
    );

  const outline = currentOutline();
  const drafts = outline.nodes.filter(
    (node) => node.kind === "draft" && node.text.trim(),
  ).length;
  const failedReviewCount = Object.values(reviewResults).filter(
    (result) => result.state === "error",
  ).length;
  const selectedReviewCount = reviewItems.filter(
    (item) =>
      selectedReviewIds.has(item.id) &&
      reviewResults[item.id]?.state !== "created",
  ).length;
  const displayDate = isCurrent
    ? (document?.dateCreated ?? initialDocument.dateCreated)
    : scratchpadHistoryDate(document ?? initialDocument);
  const busy = converting || reviewProcessing || undoingConversion;

  return (
    <section
      className="scratchpad-editor"
      inert={undoingConversion}
      aria-busy={undoingConversion}
      aria-label={t`Editor for ${document?.title || (document?.state === "active" ? uiCopy("current scratchpad") : uiCopy("scratchpad"))}`}
    >
      <header
        className={`scratchpad-note-header${title || titleFocused ? "" : " is-untitled"}`}
      >
        <div className="scratchpad-title-row">
          {/* An untitled note is headed by its date; the title appears on click. */}
          <input
            aria-label={t({ message: "Note title" })}
            className={title ? undefined : "is-empty"}
            maxLength={160}
            placeholder={
              titleFocused
                ? t({ message: "Add title" })
                : formatScratchDate(displayDate)
            }
            type="text"
            value={title}
            onBlur={() => {
              const trimmed = title.trim();
              titleRef.current = trimmed;
              setTitle(trimmed);
              setTitleFocused(false);
            }}
            onChange={(event) => {
              titleRef.current = event.target.value;
              setTitle(event.target.value);
            }}
            onFocus={() => setTitleFocused(true)}
          />
          <span className="scratchpad-title-meta">
            {isCurrent ? (
              <small>
                <Trans>Current note</Trans>
              </small>
            ) : null}
            <time dateTime={displayDate}>{formatScratchDate(displayDate)}</time>
          </span>
        </div>
        <div className="scratchpad-header-actions">
          {nativeSaveState ? (
            <RecordWriteNotice
              repository={repository}
              target={{
                kind: "scratchpad",
                id: document?.id ?? initialDocument.id,
              }}
            />
          ) : null}
          <span
            className={`scratchpad-save-state is-${saveState}`}
            role={saveState === "error" ? "status" : undefined}
          >
            {saveState === "error"
              ? nativeSaveState
                ? translate({ message: "Save needs review" })
                : translate({ message: "Not saved" })
              : saveState === "saving" || nativeSaveState
                ? ""
                : translate({ message: "Saved" })}
          </span>
          {onReactivate && !phoneLine ? (
            <button
              className="text-action scratchpad-reactivate-action"
              disabled={reactivationDisabled}
              type="button"
              onClick={onReactivate}
            >
              <RotateCcw aria-hidden="true" size={17} />
              {reactivating
                ? t({ message: "Resuming…" })
                : t({ message: "Resume as current" })}
            </button>
          ) : null}
          {isCurrent && drafts ? (
            <button
              aria-label={t({ message: "Create tasks" })}
              className="text-action scratchpad-review-action"
              disabled={busy}
              type="button"
              ref={reviewTriggerRef}
              onClick={openReview}
            >
              <ListChecks aria-hidden="true" size={17} />{" "}
              <Trans>Create tasks</Trans>
            </button>
          ) : null}
          {onCollapse ? (
            <button
              aria-expanded="true"
              aria-label={uiCopy("Collapse")}
              className="scratchpad-note-collapse"
              type="button"
              onClick={onCollapse}
            >
              <ChevronDown aria-hidden="true" size={18} />
            </button>
          ) : null}
          {!isCurrent && (onDelete || drafts || (phoneLine && onReactivate)) ? (
            <ScratchNoteActions
              disabled={reactivationDisabled || busy}
              onCreateTasks={drafts ? openReview : undefined}
              onDelete={onDelete}
              onReactivate={phoneLine ? onReactivate : undefined}
            />
          ) : null}
        </div>
      </header>
      {error ? (
        <div className="scratchpad-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void load()}>
            <Trans>Reload</Trans>
          </button>
        </div>
      ) : null}
      <Suspense fallback={<div className="scratchpad-loading" />}>
        <ScratchpadNoteEditor
          actions={editorActions}
          ariaLabel={t({ message: "Scratchpad outline" })}
          autoFocus={isCurrent}
          capture={capture}
          completeRecords={completeRecords}
          handle={editorRef}
          initialText={source}
          preview={preview}
          readOnly={busy}
          tasks={taskViews}
          onCaretLine={setCaretLine}
          onChange={changeSource}
        />
      </Suspense>
      {reviewOpen ? (
        <div className="scratchpad-dialog-backdrop" role="presentation">
          <section
            aria-labelledby="review-scratchpad-title"
            aria-modal="true"
            className="scratchpad-dialog scratchpad-review-dialog"
            ref={reviewRef}
            role="dialog"
            tabIndex={-1}
          >
            <header>
              <div>
                <p className="eyebrow">
                  <Trans>Choose what becomes a task</Trans>
                </p>
                <h2 id="review-scratchpad-title">
                  <Trans>Create tasks</Trans>
                </h2>
              </div>
              <button
                aria-label={t({ message: "Close" })}
                ref={reviewCloseRef}
                disabled={reviewProcessing}
                type="button"
                onClick={() => setReviewOpen(false)}
              >
                <X aria-hidden="true" size={20} />
              </button>
            </header>
            <p>
              <Trans>
                Selected drafts become tasks linked to their Markdown notes.
                Everything else stays in this scratchpad so you can keep
                working.
              </Trans>
            </p>
            <div className="scratchpad-review-toolbar">
              <span>
                <Trans>
                  {selectedReviewCount} of {reviewItems.length} selected
                </Trans>
              </span>
              <button
                disabled={reviewProcessing}
                type="button"
                onClick={() =>
                  setSelectedReviewIds(
                    selectedReviewCount === reviewItems.length
                      ? new Set()
                      : new Set(
                          reviewItems
                            .filter(
                              (item) =>
                                reviewResults[item.id]?.state !== "created",
                            )
                            .map((item) => item.id),
                        ),
                  )
                }
              >
                {selectedReviewCount === reviewItems.length
                  ? t({ message: "Clear selection" })
                  : t({ message: "Select all" })}
              </button>
            </div>
            <div
              aria-label={t({ message: "Task drafts" })}
              className="scratchpad-review-list"
              role="list"
            >
              {reviewItems.map((item) => {
                const result = reviewResults[item.id];
                const sourceIndex = outline.nodes.findIndex(
                  (node) => node.id === item.id,
                );
                const branchEnd =
                  sourceIndex < 0
                    ? sourceIndex
                    : scratchSubtreeEnd(outline.nodes, sourceIndex);
                const hasDraftDescendants =
                  sourceIndex >= 0 &&
                  outline.nodes
                    .slice(sourceIndex + 1, branchEnd)
                    .some(
                      (node) =>
                        node.kind === "draft" && Boolean(node.text.trim()),
                    );
                return (
                  <div
                    className={`scratchpad-review-item${result ? ` is-${result.state}` : ""}`}
                    key={item.id}
                    role="listitem"
                    style={{ "--review-depth": item.depth } as CSSProperties}
                  >
                    <label>
                      <input
                        checked={
                          result?.state === "created" ||
                          selectedReviewIds.has(item.id)
                        }
                        disabled={
                          reviewProcessing || result?.state === "created"
                        }
                        type="checkbox"
                        onChange={(event) =>
                          setSelectedReviewIds((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(item.id);
                            else next.delete(item.id);
                            return next;
                          })
                        }
                      />
                      <span>{item.text}</span>
                    </label>
                    {hasDraftDescendants && result?.state !== "created" ? (
                      <button
                        className="scratchpad-review-branch"
                        disabled={reviewProcessing}
                        type="button"
                        onClick={() => toggleReviewBranch(item.id)}
                      >
                        <Trans>Select branch</Trans>
                      </button>
                    ) : null}
                    {result?.state === "creating" ? (
                      <span className="scratchpad-review-status">
                        <Trans>Creating…</Trans>
                      </span>
                    ) : null}
                    {result?.state === "created" ? (
                      <span className="scratchpad-review-status is-success">
                        <Check aria-hidden="true" size={14} />{" "}
                        <Trans>Created</Trans>
                      </span>
                    ) : null}
                    {result?.state === "error" ? (
                      <span className="scratchpad-review-error" role="alert">
                        <CircleAlert aria-hidden="true" size={15} />{" "}
                        {result.message}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <div className="scratchpad-dialog-actions">
              <button
                className="text-action"
                disabled={reviewProcessing}
                type="button"
                onClick={() => setReviewOpen(false)}
              >
                <Trans>Keep writing</Trans>
              </button>
              <button
                className="outline-action"
                disabled={reviewProcessing || !selectedReviewCount}
                type="button"
                onClick={() => void createReviewedTasks()}
              >
                {failedReviewCount ? (
                  <RotateCcw aria-hidden="true" size={17} />
                ) : (
                  <FileCheck2 aria-hidden="true" size={17} />
                )}{" "}
                {reviewProcessing
                  ? t({ message: "Creating…" })
                  : failedReviewCount
                    ? plural(selectedReviewCount, {
                        one: "Retry # task",
                        other: "Retry # tasks",
                      })
                    : plural(selectedReviewCount, {
                        one: "Create # task",
                        other: "Create # tasks",
                      })}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {notice ? (
        <div className="scratchpad-notice" role="status">
          <span>{notice.message}</span>
          {notice.conversions?.length ? (
            <button
              className="scratchpad-notice-action"
              type="button"
              onClick={() => void undoConversion()}
            >
              <Trans>Undo</Trans>
            </button>
          ) : null}
          {notice.tasks?.length ? (
            <button
              className="scratchpad-notice-action"
              type="button"
              onClick={() => {
                onOpenTask(notice.tasks![0]!);
                setNotice(null);
              }}
            >
              {notice.tasks.length === 1
                ? t({ message: "Open task" })
                : t({ message: "Open first" })}
            </button>
          ) : null}
          <button
            aria-label={t({ message: "Dismiss" })}
            type="button"
            onClick={() => setNotice(null)}
          >
            <X aria-hidden="true" size={16} />
          </button>
        </div>
      ) : null}
    </section>
  );
}

/** The menu at the end of an earlier note's line. */
export function ScratchNoteActions({
  disabled,
  onCreateTasks,
  onDelete,
  onReactivate,
}: {
  disabled: boolean;
  onCreateTasks?: () => void;
  onDelete?: () => void;
  /** Offered here on a phone, where the line has no room for the button. */
  onReactivate?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);

  useScratchpadMenu(menuOpen, menuRef, menuTriggerRef, () =>
    setMenuOpen(false),
  );

  useMenuDirection(menuOpen, menuRef, menuTriggerRef);

  return (
    <div className="scratchpad-document-actions">
      <button
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        aria-label={translate({ message: "Note actions" })}
        className="scratchpad-document-menu-trigger"
        disabled={disabled}
        ref={menuTriggerRef}
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
      >
        <MoreHorizontal aria-hidden="true" size={18} />
      </button>
      {menuOpen ? (
        <div
          aria-label={translate({ message: "Note actions" })}
          className="scratchpad-row-menu"
          ref={menuRef}
          role="menu"
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            setMenuOpen(false);
            menuTriggerRef.current?.focus();
          }}
        >
          {onReactivate ? (
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onReactivate();
              }}
            >
              <RotateCcw aria-hidden="true" size={17} />{" "}
              <Trans>Resume as current</Trans>
            </button>
          ) : null}
          {onCreateTasks ? (
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onCreateTasks();
              }}
            >
              <ListChecks aria-hidden="true" size={17} />{" "}
              <Trans>Create tasks</Trans>
            </button>
          ) : null}
          {onDelete ? (
            <button
              className="danger"
              role="menuitem"
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onDelete();
              }}
            >
              <Trash2 aria-hidden="true" size={17} /> <Trans>Delete note</Trans>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
