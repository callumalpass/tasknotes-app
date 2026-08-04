import {
  Check,
  FileCheck2,
  FilePenLine,
  GripVertical,
  Link2,
  MoreHorizontal,
  Plus,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type CSSProperties,
} from "react";

import {
  activeCaptureToken,
  applyCaptureSuggestion,
  captureSuggestionRequest,
  captureTriggers,
  configuredCaptureSuggestions,
} from "../domain/capture-autosuggest";
import { recordCompletion, recordMatchesLink } from "../domain/completion";
import {
  changeScratchDepth,
  createScratchNode,
  moveScratchSubtree,
  nearestTaskAncestor,
  parseScratchBody,
  removeScratchNode,
  scratchpadTitle,
  serializeScratchNodes,
  type ScratchDropPlacement,
  type ScratchNode,
  type ScratchpadDocument,
} from "../domain/scratchpad";
import {
  parseTaskCapture,
  preloadTaskCapture,
  type TaskCaptureResult,
} from "../domain/task-capture";
import { selectionFeedback, successFeedback } from "../native/feedback";
import { useRepository } from "./repository-context";

import type { FieldCompletion } from "../domain/completion";
import type { Task } from "../domain/task";

interface DragState {
  sourceId: string;
  targetId?: string;
  placement?: ScratchDropPlacement;
}

export function ScratchpadScreen({
  onOpenTask,
}: {
  onOpenTask(task: Task): void;
}) {
  const { repository, configuration, createTask, updateTask } = useRepository();
  const [document, setDocument] = useState<ScratchpadDocument | null>(null);
  const [nodes, setNodes] = useState<ScratchNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">(
    "saved",
  );
  const [activeId, setActiveId] = useState<string>();
  const [cursor, setCursor] = useState(0);
  const [preview, setPreview] = useState<{
    id: string;
    text: string;
    result: TaskCaptureResult;
  } | null>(null);
  const [suggestionState, setSuggestionState] = useState<{
    key: string;
    values: FieldCompletion[];
  }>({ key: "", values: [] });
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [menuId, setMenuId] = useState<string>();
  const [drag, setDrag] = useState<DragState | null>(null);
  const [finishOpen, setFinishOpen] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [convertingId, setConvertingId] = useState<string>();
  const [notice, setNotice] = useState("");
  const documentRef = useRef<ScratchpadDocument | null>(null);
  const nodesRef = useRef<ScratchNode[]>([]);
  const saveTail = useRef<Promise<unknown>>(Promise.resolve());
  const focusAfterRender = useRef<{ id: string; cursor?: number } | undefined>(
    undefined,
  );

  useEffect(() => {
    const timeout = window.setTimeout(preloadTaskCapture, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  const load = useCallback(async () => {
    if (!repository.getActiveScratchpad) {
      setError("Scratchpad storage is not available for this collection.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const next = await repository.getActiveScratchpad();
      const parsed = parseScratchBody(next.body);
      const tasks = parsed.some((node) => node.kind === "task")
        ? await repository.list({
            status: "all",
            archived: "include",
            limit: 50_000,
          })
        : [];
      const hydrated = hydrateLinkedNodes(
        parsed,
        tasks,
        configuration.linkWriteFormat,
      );
      const visible = hydrated.length ? hydrated : [createScratchNode()];
      documentRef.current = next;
      nodesRef.current = visible;
      setDocument(next);
      setNodes(visible);
      setSaveState("saved");
    } catch (reason) {
      setError(message(reason));
    } finally {
      setLoading(false);
    }
  }, [configuration.linkWriteFormat, repository]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  const persist = useCallback(
    (nextNodes: readonly ScratchNode[]) => {
      const body = scratchBody(nextNodes);
      const current = documentRef.current;
      if (!current || !repository.saveScratchpad)
        return Promise.reject(new Error("Scratchpad storage is unavailable."));
      if (body === current.body) return Promise.resolve(current);
      setSaveState("saving");
      const operation = saveTail.current
        .catch(() => undefined)
        .then(async () => {
          const latest = documentRef.current;
          if (!latest) throw new Error("The scratchpad is not open.");
          const saved = await repository.saveScratchpad!({
            id: latest.id,
            path: latest.path,
            revision: latest.revision,
            baseBody: latest.body,
            body,
          });
          documentRef.current = saved;
          setDocument(saved);
          setSaveState("saved");
          return saved;
        })
        .catch((reason) => {
          setSaveState("error");
          setError(message(reason));
          throw reason;
        });
      saveTail.current = operation;
      return operation;
    },
    [repository],
  );

  useEffect(() => {
    if (!document) return;
    const body = scratchBody(nodes);
    if (body === documentRef.current?.body) return;
    const timeout = window.setTimeout(() => void persist(nodes), 260);
    return () => window.clearTimeout(timeout);
  }, [document, nodes, persist]);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    const request = focusAfterRender.current;
    if (!request) return;
    focusAfterRender.current = undefined;
    const input = globalThis.document.querySelector<HTMLInputElement>(
      `[data-scratch-input="${CSS.escape(request.id)}"]`,
    );
    input?.focus();
    const position = request.cursor ?? input?.value.length ?? 0;
    input?.setSelectionRange(position, position);
  }, [nodes]);

  const activeNode = nodes.find((node) => node.id === activeId);
  const triggers = useMemo(
    () => captureTriggers(configuration),
    [configuration],
  );
  const activeToken = useMemo(
    () =>
      activeNode?.kind === "draft"
        ? activeCaptureToken(activeNode.text, cursor, triggers)
        : undefined,
    [activeNode, cursor, triggers],
  );
  const suggestionRequest = useMemo(
    () =>
      activeToken
        ? captureSuggestionRequest(activeToken, configuration)
        : undefined,
    [activeToken, configuration],
  );
  const suggestionKey = suggestionRequest
    ? [
        activeId,
        suggestionRequest.field,
        suggestionRequest.query ?? "",
        activeToken?.start ?? 0,
      ].join("\0")
    : "";
  const suggestions =
    suggestionKey === suggestionState.key ? suggestionState.values : [];

  useEffect(() => {
    if (!suggestionRequest || !suggestionKey) return;
    let active = true;
    const fallback = configuredCaptureSuggestions(suggestionRequest);
    void repository.completeField(suggestionRequest).then(
      (values) => {
        if (!active) return;
        setSuggestionState({
          key: suggestionKey,
          values: values.length ? values : fallback,
        });
        setSelectedSuggestion(0);
      },
      () => {
        if (!active) return;
        setSuggestionState({ key: suggestionKey, values: fallback });
      },
    );
    return () => {
      active = false;
    };
  }, [repository, suggestionKey, suggestionRequest]);

  useEffect(() => {
    if (!activeNode || activeNode.kind !== "draft" || !activeNode.text.trim())
      return;
    let active = true;
    const id = activeNode.id;
    const text = activeNode.text;
    const timeout = window.setTimeout(() => {
      void parseTaskCapture(text, configuration).then(
        (result) => {
          if (active) setPreview({ id, text, result });
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
  }, [activeNode, configuration]);

  function updateNodes(next: ScratchNode[]) {
    nodesRef.current = next;
    setNodes(next);
    setError("");
  }

  function changeNode(id: string, change: Partial<ScratchNode>) {
    updateNodes(
      nodesRef.current.map((node) =>
        node.id === id ? { ...node, ...change } : node,
      ),
    );
  }

  function chooseSuggestion(value: FieldCompletion) {
    const node = nodesRef.current.find(
      (candidate) => candidate.id === activeId,
    );
    if (!node || !activeToken) return;
    const next = applyCaptureSuggestion(node.text, activeToken, value.value);
    changeNode(node.id, { text: next.text });
    setCursor(next.cursor);
    setSuggestionState({ key: "", values: [] });
    focusAfterRender.current = { id: node.id, cursor: next.cursor };
  }

  function handleKeyDown(
    event: KeyboardEvent<HTMLInputElement>,
    node: ScratchNode,
  ) {
    if (suggestions.length) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedSuggestion((current) =>
          event.key === "ArrowDown"
            ? (current + 1) % suggestions.length
            : (current - 1 + suggestions.length) % suggestions.length,
        );
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        chooseSuggestion(suggestions[selectedSuggestion]!);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setSuggestionState({ key: "", values: [] });
        return;
      }
    }
    if (event.key === "Tab") {
      event.preventDefault();
      updateNodes(
        changeScratchDepth(nodesRef.current, node.id, event.shiftKey ? -1 : 1),
      );
      focusAfterRender.current = { id: node.id, cursor };
      selectionFeedback();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const position = event.currentTarget.selectionStart ?? node.text.length;
      const before = node.text.slice(0, position);
      const after = node.text.slice(position);
      const created = createScratchNode(
        node.kind === "note" ? "note" : "draft",
        node.depth,
        after,
      );
      const current = nodesRef.current;
      const index = current.findIndex((candidate) => candidate.id === node.id);
      const next = [
        ...current.slice(0, index),
        { ...node, text: before },
        created,
        ...current.slice(index + 1),
      ];
      focusAfterRender.current = { id: created.id, cursor: 0 };
      updateNodes(next);
      return;
    }
    if (event.key === "Backspace" && !node.text) {
      event.preventDefault();
      const current = nodesRef.current;
      if (current.length === 1) return;
      const index = current.findIndex((candidate) => candidate.id === node.id);
      const previous = current[index - 1];
      if (previous)
        focusAfterRender.current = {
          id: previous.id,
          cursor: previous.text.length,
        };
      updateNodes(removeScratchNode(current, node.id));
    }
  }

  async function convertNode(id: string) {
    if (convertingId || finishing) return;
    setConvertingId(id);
    setError("");
    try {
      const converted = await createTaskForNode(nodesRef.current, id);
      updateNodes(converted.nodes);
      await persist(converted.nodes);
      await linkExistingChildren(converted.nodes, id, converted.task);
      successFeedback();
      setNotice(`Created “${converted.task.title}”`);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setConvertingId(undefined);
    }
  }

  async function createTaskForNode(source: ScratchNode[], id: string) {
    const index = source.findIndex((node) => node.id === id);
    const node = source[index];
    if (!node || node.kind !== "draft")
      throw new Error("Only draft items can become TaskNotes.");
    if (!node.text.trim()) throw new Error("Add a task title first.");
    const result: TaskCaptureResult = await parseTaskCapture(
      node.text,
      configuration,
    ).catch(() => ({
      input: { title: node.text.trim() },
      preview: [],
    }));
    const parent = nearestTaskAncestor(source, index);
    const projects = [
      ...(result.input.projects ?? []),
      ...(parent?.link ? [parent.link] : []),
    ].filter((value, candidate, values) => values.indexOf(value) === candidate);
    const task = await createTask({
      ...result.input,
      ...(projects.length ? { projects } : {}),
    });
    const link = recordCompletion(
      {
        path: task.path,
        label: task.title,
        frontmatter: task.frontmatter,
        types: ["task"],
      },
      configuration.linkWriteFormat,
    ).value;
    return {
      task,
      nodes: source.map((candidate) =>
        candidate.id === id
          ? {
              ...candidate,
              kind: "task" as const,
              text: task.title,
              link,
              taskId: task.id,
            }
          : candidate,
      ),
    };
  }

  async function linkExistingChildren(
    source: ScratchNode[],
    parentId: string,
    parentTask: Task,
  ) {
    const parentIndex = source.findIndex((node) => node.id === parentId);
    if (parentIndex < 0) return;
    const parentLink = recordCompletion(
      {
        path: parentTask.path,
        label: parentTask.title,
        frontmatter: parentTask.frontmatter,
        types: ["task"],
      },
      configuration.linkWriteFormat,
    ).value;
    for (let index = parentIndex + 1; index < source.length; index += 1) {
      const node = source[index]!;
      if (node.depth <= source[parentIndex]!.depth) break;
      if (
        node.kind !== "task" ||
        nearestTaskAncestor(source, index)?.id !== parentId
      )
        continue;
      const task = await resolveLinkedTask(node);
      if (!task || task.projects.some((value) => value === parentLink))
        continue;
      await updateTask(task.id, { projects: [...task.projects, parentLink] });
    }
  }

  async function resolveLinkedTask(node: ScratchNode): Promise<Task | null> {
    if (node.taskId) {
      const task = await repository.get(node.taskId);
      if (task) return task;
    }
    const tasks = await repository.list({
      status: "all",
      archived: "include",
      limit: 50_000,
    });
    return (
      tasks.find(
        (task) => node.link && recordMatchesLink(task.path, node.link),
      ) ?? null
    );
  }

  async function openLinkedNode(node: ScratchNode) {
    try {
      const task = await resolveLinkedTask(node);
      if (!task) throw new Error("The linked TaskNote could not be found.");
      onOpenTask(task);
    } catch (reason) {
      setError(message(reason));
    }
  }

  async function finishScratchpad() {
    if (!repository.archiveScratchpad || finishing) return;
    setFinishing(true);
    setError("");
    try {
      let working = nodesRef.current.filter(
        (node) => node.kind === "task" || Boolean(node.text.trim()),
      );
      for (const node of [...working]) {
        if (node.kind !== "draft") continue;
        const converted = await createTaskForNode(working, node.id);
        working = converted.nodes;
        updateNodes(working);
        await persist(working);
        await linkExistingChildren(working, node.id, converted.task);
      }
      const latest = await persist(working);
      const title = scratchpadTitle(working);
      const result = await repository.archiveScratchpad({
        id: latest.id,
        path: latest.path,
        revision: latest.revision,
        baseBody: latest.body,
        title,
        body: scratchBody(working),
      });
      documentRef.current = result.active;
      const empty = [createScratchNode()];
      nodesRef.current = empty;
      setDocument(result.active);
      setNodes(empty);
      setFinishOpen(false);
      setNotice(`Finished “${title}”`);
      successFeedback();
    } catch (reason) {
      setError(message(reason));
    } finally {
      setFinishing(false);
    }
  }

  function beginDrag(event: ReactPointerEvent, sourceId: string) {
    if (event.button !== 0) return;
    event.preventDefault();
    let drop: DragState = { sourceId };
    setDrag(drop);
    const move = (pointer: PointerEvent) => {
      const row = globalThis.document
        .elementFromPoint(pointer.clientX, pointer.clientY)
        ?.closest<HTMLElement>("[data-scratch-row]");
      const targetId = row?.dataset.scratchRow;
      if (!row || !targetId || targetId === sourceId) return;
      const rect = row.getBoundingClientRect();
      const ratio = (pointer.clientY - rect.top) / Math.max(1, rect.height);
      const placement: ScratchDropPlacement =
        pointer.clientX > rect.left + 78
          ? "inside"
          : ratio < 0.5
            ? "before"
            : "after";
      drop = { sourceId, targetId, placement };
      setDrag(drop);
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      setDrag(null);
      if (!drop.targetId || !drop.placement) return;
      const next = moveScratchSubtree(
        nodesRef.current,
        sourceId,
        drop.targetId,
        drop.placement,
      );
      updateNodes(next);
      selectionFeedback();
    };
    const cancel = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", cancel, { once: true });
  }

  if (loading)
    return (
      <section className="screen scratchpad-screen" aria-busy="true">
        <header className="scratchpad-header">
          <div>
            <p className="eyebrow">Working outline</p>
            <h1>Scratchpad</h1>
          </div>
        </header>
        <div className="scratchpad-loading" />
      </section>
    );

  const drafts = nodes.filter(
    (node) => node.kind === "draft" && node.text.trim(),
  ).length;
  const notes = nodes.filter(
    (node) => node.kind === "note" && node.text.trim(),
  ).length;
  const linked = nodes.filter((node) => node.kind === "task").length;

  return (
    <section
      className="screen scratchpad-screen"
      aria-labelledby="scratchpad-title"
    >
      <header className="scratchpad-header">
        <div>
          <p className="eyebrow">Working outline</p>
          <h1 id="scratchpad-title">Scratchpad</h1>
        </div>
        <div className="scratchpad-header-actions">
          <span
            className={`scratchpad-save-state is-${saveState}`}
            role="status"
          >
            {saveState === "saving"
              ? "Saving"
              : saveState === "error"
                ? "Not saved"
                : "Saved"}
          </span>
          <button
            className="outline-action scratchpad-finish"
            disabled={!drafts && !linked && !notes}
            type="button"
            onClick={() => setFinishOpen(true)}
          >
            <Check aria-hidden="true" size={17} /> Finish
          </button>
        </div>
      </header>
      <p className="scratchpad-introduction">
        Write first. Use Tab to nest an item, or drag its handle to reshape the
        outline.
      </p>
      {error ? (
        <div className="scratchpad-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void load()}>
            Reload
          </button>
        </div>
      ) : null}
      <div
        className="scratchpad-outline"
        role="tree"
        aria-label="Scratchpad outline"
      >
        {nodes.map((node) => {
          const activePreview =
            preview?.id === node.id && preview.text === node.text
              ? preview.result.preview
              : [];
          const dropTarget =
            drag?.targetId === node.id ? drag.placement : undefined;
          return (
            <div
              className={`scratchpad-row kind-${node.kind}${drag?.sourceId === node.id ? " is-dragging" : ""}${dropTarget ? ` drop-${dropTarget}` : ""}`}
              data-scratch-row={node.id}
              key={node.id}
              role="treeitem"
              aria-level={node.depth + 1}
              style={{ "--scratch-depth": node.depth } as CSSProperties}
            >
              <div className="scratchpad-row-main">
                <button
                  aria-label={`Move ${node.text || "empty item"}`}
                  className="scratchpad-drag-handle"
                  type="button"
                  onPointerDown={(event) => beginDrag(event, node.id)}
                >
                  <GripVertical aria-hidden="true" size={18} />
                </button>
                {node.kind === "task" ? (
                  <Link2
                    className="scratchpad-kind-icon"
                    aria-hidden="true"
                    size={17}
                  />
                ) : (
                  <button
                    aria-label={
                      node.kind === "draft" ? "Keep as note" : "Make a task"
                    }
                    className="scratchpad-kind-toggle"
                    title={node.kind === "draft" ? "Draft task" : "Note"}
                    type="button"
                    onClick={() =>
                      changeNode(node.id, {
                        kind: node.kind === "draft" ? "note" : "draft",
                      })
                    }
                  >
                    {node.kind === "draft" ? (
                      <span className="scratchpad-draft-mark" />
                    ) : (
                      <StickyNote aria-hidden="true" size={16} />
                    )}
                  </button>
                )}
                {node.kind === "task" ? (
                  <button
                    className="scratchpad-task-link"
                    type="button"
                    onClick={() => void openLinkedNode(node)}
                  >
                    {node.text}
                  </button>
                ) : (
                  <input
                    aria-label={`${node.kind === "draft" ? "Draft task" : "Note"}: ${node.text || "empty"}`}
                    autoComplete="off"
                    data-scratch-input={node.id}
                    placeholder={
                      node.kind === "draft"
                        ? "What needs doing?"
                        : "Add context…"
                    }
                    value={node.text}
                    onChange={(event) => {
                      changeNode(node.id, { text: event.target.value });
                      setCursor(
                        event.target.selectionStart ??
                          event.target.value.length,
                      );
                    }}
                    onFocus={(event) => {
                      setActiveId(node.id);
                      setCursor(
                        event.currentTarget.selectionStart ?? node.text.length,
                      );
                    }}
                    onClick={(event) =>
                      setCursor(
                        event.currentTarget.selectionStart ?? node.text.length,
                      )
                    }
                    onKeyDown={(event) => handleKeyDown(event, node)}
                    onSelect={(event) =>
                      setCursor(
                        event.currentTarget.selectionStart ?? node.text.length,
                      )
                    }
                  />
                )}
                {node.kind === "draft" && node.text.trim() ? (
                  <button
                    aria-label={`Create TaskNote for ${node.text}`}
                    className="scratchpad-convert-line"
                    disabled={Boolean(convertingId) || finishing}
                    title="Create TaskNote"
                    type="button"
                    onClick={() => void convertNode(node.id)}
                  >
                    <FileCheck2 aria-hidden="true" size={18} />
                  </button>
                ) : null}
                <button
                  aria-expanded={menuId === node.id}
                  aria-haspopup="menu"
                  aria-label={`Actions for ${node.text || "empty item"}`}
                  className="scratchpad-row-menu-trigger"
                  type="button"
                  onClick={() =>
                    setMenuId((current) =>
                      current === node.id ? undefined : node.id,
                    )
                  }
                >
                  <MoreHorizontal aria-hidden="true" size={18} />
                </button>
              </div>
              {node.kind === "draft" && activePreview.length ? (
                <div
                  className="scratchpad-nlp-preview"
                  aria-label="Recognized task details"
                >
                  {activePreview.map((item) => (
                    <span key={item.key}>{item.label}</span>
                  ))}
                </div>
              ) : null}
              {activeId === node.id && suggestions.length ? (
                <div
                  className="scratchpad-suggestions"
                  role="listbox"
                  aria-label="Suggestions"
                >
                  {suggestions.map((suggestion, index) => (
                    <button
                      aria-selected={index === selectedSuggestion}
                      className={
                        index === selectedSuggestion ? "is-selected" : undefined
                      }
                      key={`${suggestion.kind}:${suggestion.value}`}
                      role="option"
                      type="button"
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={() => chooseSuggestion(suggestion)}
                    >
                      <span>{suggestion.label}</span>
                      {suggestion.detail ? (
                        <small>{suggestion.detail}</small>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}
              {menuId === node.id ? (
                <div
                  className="scratchpad-row-menu"
                  role="menu"
                  aria-label={`Actions for ${node.text || "item"}`}
                >
                  {node.kind === "draft" && node.text.trim() ? (
                    <button
                      role="menuitem"
                      type="button"
                      onClick={() => {
                        setMenuId(undefined);
                        void convertNode(node.id);
                      }}
                    >
                      <FileCheck2 aria-hidden="true" size={17} /> Create
                      TaskNote
                    </button>
                  ) : null}
                  {node.kind !== "task" ? (
                    <button
                      role="menuitem"
                      type="button"
                      onClick={() => {
                        changeNode(node.id, {
                          kind: node.kind === "draft" ? "note" : "draft",
                        });
                        setMenuId(undefined);
                      }}
                    >
                      {node.kind === "draft" ? (
                        <StickyNote aria-hidden="true" size={17} />
                      ) : (
                        <FilePenLine aria-hidden="true" size={17} />
                      )}
                      {node.kind === "draft" ? "Keep as note" : "Make a task"}
                    </button>
                  ) : null}
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      const index = nodesRef.current.findIndex(
                        (candidate) => candidate.id === node.id,
                      );
                      const child = createScratchNode("draft", node.depth + 1);
                      focusAfterRender.current = { id: child.id };
                      updateNodes([
                        ...nodesRef.current.slice(0, index + 1),
                        child,
                        ...nodesRef.current.slice(index + 1),
                      ]);
                      setMenuId(undefined);
                    }}
                  >
                    <Plus aria-hidden="true" size={17} /> Add child
                  </button>
                  <button
                    className="danger"
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      updateNodes(removeScratchNode(nodesRef.current, node.id));
                      setMenuId(undefined);
                    }}
                  >
                    <Trash2 aria-hidden="true" size={17} /> Delete item
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="scratchpad-add-actions">
        <button
          type="button"
          onClick={() => {
            const created = createScratchNode("draft");
            focusAfterRender.current = { id: created.id };
            updateNodes([...nodesRef.current, created]);
          }}
        >
          <Plus aria-hidden="true" size={17} /> Add task
        </button>
        <button
          type="button"
          onClick={() => {
            const created = createScratchNode("note");
            focusAfterRender.current = { id: created.id };
            updateNodes([...nodesRef.current, created]);
          }}
        >
          <StickyNote aria-hidden="true" size={16} /> Add note
        </button>
      </div>
      <footer className="scratchpad-path">
        <FilePenLine aria-hidden="true" size={14} />
        <span>{document?.path}</span>
      </footer>
      {finishOpen ? (
        <div
          className="scratchpad-dialog-backdrop"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget && !finishing)
              setFinishOpen(false);
          }}
        >
          <section
            aria-labelledby="finish-scratchpad-title"
            aria-modal="true"
            className="scratchpad-dialog"
            role="dialog"
          >
            <header>
              <div>
                <p className="eyebrow">Commit the outline</p>
                <h2 id="finish-scratchpad-title">Finish this scratchpad?</h2>
              </div>
              <button
                aria-label="Close"
                disabled={finishing}
                type="button"
                onClick={() => setFinishOpen(false)}
              >
                <X aria-hidden="true" size={20} />
              </button>
            </header>
            <p>
              {drafts
                ? `${drafts} draft ${drafts === 1 ? "task" : "tasks"} will become TaskNotes. `
                : "No draft tasks remain. "}
              {notes
                ? `${notes} ${notes === 1 ? "note stays" : "notes stay"} in the outline. `
                : ""}
              The linked outline is then saved in your collection and a new
              scratchpad opens.
            </p>
            <dl>
              <div>
                <dt>New tasks</dt>
                <dd>{drafts}</dd>
              </div>
              <div>
                <dt>Already linked</dt>
                <dd>{linked}</dd>
              </div>
              <div>
                <dt>Notes retained</dt>
                <dd>{notes}</dd>
              </div>
            </dl>
            <div className="scratchpad-dialog-actions">
              <button
                className="text-action"
                disabled={finishing}
                type="button"
                onClick={() => setFinishOpen(false)}
              >
                Keep writing
              </button>
              <button
                className="outline-action"
                disabled={finishing}
                type="button"
                onClick={() => void finishScratchpad()}
              >
                <Check aria-hidden="true" size={17} />{" "}
                {finishing ? "Finishing…" : "Create tasks and finish"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {notice ? (
        <div className="scratchpad-notice" role="status">
          <span>{notice}</span>
          <button
            aria-label="Dismiss"
            type="button"
            onClick={() => setNotice("")}
          >
            <X aria-hidden="true" size={16} />
          </button>
        </div>
      ) : null}
    </section>
  );
}

function scratchBody(nodes: readonly ScratchNode[]): string {
  return serializeScratchNodes(
    nodes.filter((node) => node.kind === "task" || Boolean(node.text.trim())),
  );
}

function hydrateLinkedNodes(
  nodes: readonly ScratchNode[],
  tasks: readonly Task[],
  linkWriteFormat: "wikilink" | "markdown",
): ScratchNode[] {
  return nodes.map((node) => {
    if (node.kind !== "task" || !node.link) return node;
    const task = tasks.find((candidate) =>
      recordMatchesLink(candidate.path, node.link!),
    );
    if (!task) return node;
    return {
      ...node,
      text: task.title,
      taskId: task.id,
      link: recordCompletion(
        {
          path: task.path,
          label: task.title,
          frontmatter: task.frontmatter,
          types: ["task"],
        },
        linkWriteFormat,
      ).value,
    };
  });
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
