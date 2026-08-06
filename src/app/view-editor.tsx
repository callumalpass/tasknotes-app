import { X } from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import {
  createViewDocument,
  emptyViewDraft,
  readViewDraft,
  removeViewFromDocument,
  updateViewDocument,
  type EditableViewDraft,
} from "../domain/view-document";
import { taskNotesViewSourcePath } from "../domain/default-view-source";
import {
  previewViewDraft,
  type ViewDraftPreview,
} from "../domain/view-preview";
import { loadViewEditorForm } from "./view-editor-loader";
import { useRepository } from "./repository-context";

import type { TaskView, TaskViewSourceDocument } from "../domain/view";
import type { Task } from "../domain/task";
import type { TaskCollectionConfiguration } from "../domain/task-configuration";

const ViewEditorForm = lazy(async () => ({
  default: (await loadViewEditorForm()).ViewEditorForm,
}));

export function ViewEditor({
  view,
  onClose,
  onChanged,
}: {
  view?: TaskView;
  onClose(): void;
  onChanged(): Promise<void>;
}) {
  const { repository } = useRepository();
  const [source, setSource] = useState<TaskViewSourceDocument | null>(null);
  const [draft, setDraft] = useState<EditableViewDraft | null>(null);
  const [initialFingerprint, setInitialFingerprint] = useState("");
  const [configuration, setConfiguration] =
    useState<TaskCollectionConfiguration | null>(null);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [currentPreview, setCurrentPreview] = useState<ViewDraftPreview | null>(
    null,
  );
  const [filterValid, setFilterValid] = useState(true);
  const [computedValid, setComputedValid] = useState(true);
  const [confirmation, setConfirmation] = useState<"discard" | "delete" | null>(
    null,
  );
  const [status, setStatus] = useState<"loading" | "ready" | "saving">(
    "loading",
  );
  const [error, setError] = useState("");
  const editorRef = useRef<HTMLElement>(null);
  const confirmationRef = useRef<HTMLElement>(null);
  const focusedInitialEditor = useRef(false);
  const fingerprint = useMemo(() => draftFingerprint(draft), [draft]);
  const deferredDraft = useDeferredValue(draft);
  const livePreview = useMemo(
    () =>
      deferredDraft && tasks
        ? previewViewDraft(deferredDraft, tasks)
        : ({ kind: "unavailable", tasks: [] } as ViewDraftPreview),
    [deferredDraft, tasks],
  );
  const preview =
    livePreview.kind === "live" ? livePreview : (currentPreview ?? livePreview);
  const dirty =
    draft !== null && (source === null || fingerprint !== initialFingerprint);

  useEffect(() => {
    let active = true;
    void Promise.all([
      repository.taskConfiguration(),
      view ? repository.readViewSource(view.source.path) : null,
    ]).then(
      ([configuration, loadedSource]) => {
        if (!active) return;
        const next = loadedSource
          ? readViewDraft(loadedSource, view!.id)
          : emptyViewDraft("obsidian-bases");
        setSource(loadedSource);
        setDraft(next);
        setInitialFingerprint(draftFingerprint(next));
        setConfiguration(configuration);
        setStatus("ready");
      },
      (reason) => {
        if (!active) return;
        setError(message(reason));
        setStatus("ready");
      },
    );
    return () => {
      active = false;
    };
  }, [repository, view]);

  useEffect(() => {
    let active = true;
    void repository
      .list({ status: "all", archived: "include", limit: 50_000 })
      .then((loadedTasks) => {
        if (active) setTasks(loadedTasks);
      })
      .catch(() => undefined);
    if (view && typeof repository.executeView === "function")
      void repository.executeView(view).then(
        (execution) => {
          if (!active) return;
          setCurrentPreview({
            kind: "current",
            count: execution.totalCount,
            tasks: execution.rows.slice(0, 3).map(({ task }) => task),
          });
        },
        () => undefined,
      );
    return () => {
      active = false;
    };
  }, [repository, view]);

  useEffect(() => {
    if (!draft || !view || focusedInitialEditor.current) return;
    focusedInitialEditor.current = true;
    editorRef.current?.focus();
  }, [draft, view]);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  const requestClose = useCallback(() => {
    if (dirty) {
      setConfirmation("discard");
      return;
    }
    onClose();
  }, [dirty, onClose]);

  useEffect(() => {
    if (!confirmation) return;
    confirmationRef.current?.querySelector<HTMLElement>("button")?.focus();
  }, [confirmation]);

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const appRoot = document.getElementById("root");
    const previousInert = appRoot?.inert ?? false;
    const previousAriaHidden = appRoot?.getAttribute("aria-hidden");
    if (appRoot) {
      appRoot.inert = true;
      appRoot.setAttribute("aria-hidden", "true");
    }
    return () => {
      document.body.style.overflow = previousOverflow;
      if (appRoot) {
        appRoot.inert = previousInert;
        if (previousAriaHidden == null) appRoot.removeAttribute("aria-hidden");
        else appRoot.setAttribute("aria-hidden", previousAriaHidden);
      }
      previousFocus?.focus();
    };
  }, []);

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if (status === "saving") return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (confirmation) setConfirmation(null);
        else requestClose();
        return;
      }
      const focusRoot = confirmationRef.current ?? editorRef.current;
      if (event.key !== "Tab" || !focusRoot) return;
      const controls = focusableControls(focusRoot);
      if (!controls.length) return;
      const first = controls[0];
      const last = controls.at(-1)!;
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === focusRoot)
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", keyDown);
    return () => window.removeEventListener("keydown", keyDown);
  }, [confirmation, requestClose, status]);

  async function save() {
    if (!draft || !draft.name.trim() || !filterValid || !computedValid) return;
    setStatus("saving");
    setError("");
    try {
      let persisted: TaskViewSourceDocument;
      if (source) {
        persisted = await repository.updateViewSource({
          path: source.path,
          ifRevision: source.revision,
          document: updateViewDocument(source, draft),
        });
      } else {
        const format =
          draft.dialect === "obsidian-bases" ? "obsidian.base" : "mdbase.view";
        persisted = await repository.createViewSource({
          format,
          name: draft.name,
          ...(format === "obsidian.base"
            ? { path: taskNotesViewSourcePath(draft.name) }
            : {}),
          document: createViewDocument(format, draft),
        });
      }
      setSource(persisted);
      setInitialFingerprint(draftFingerprint(draft));
      onClose();
      void onChanged().catch(() => undefined);
    } catch (reason) {
      setError(message(reason));
      setStatus("ready");
    }
  }

  async function remove() {
    if (!source || !view || !draft) return;
    setConfirmation(null);
    setStatus("saving");
    setError("");
    try {
      const result = removeViewFromDocument(source, view.id);
      if (result.deleteSource) {
        await repository.deleteViewSource(source.path, source.revision);
      } else {
        await repository.updateViewSource({
          path: source.path,
          ifRevision: source.revision,
          document: result.document!,
        });
      }
      onClose();
      void onChanged().catch(() => undefined);
    } catch (reason) {
      setError(message(reason));
      setStatus("ready");
    }
  }

  const title = draft?.name.trim() || (view ? view.name : "New view");
  const canSave =
    Boolean(draft?.name.trim()) &&
    filterValid &&
    computedValid &&
    status === "ready" &&
    dirty;

  return createPortal(
    <div className="view-editor-layer">
      <button
        aria-label="Close view editor"
        className="view-editor-scrim"
        disabled={status === "saving"}
        type="button"
        onClick={requestClose}
      />
      <section
        aria-labelledby="view-editor-title"
        aria-modal="true"
        aria-busy={status === "loading" || status === "saving"}
        className="view-editor"
        ref={editorRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="view-editor-header">
          <div>
            <p className="eyebrow">
              {view ? "Edit saved view" : "Create saved view"}
            </p>
            <h1 id="view-editor-title">{title}</h1>
            <small>{previewLabel(preview)}</small>
          </div>
          <button
            aria-label="Close view editor"
            className="quiet-icon"
            disabled={status === "saving"}
            type="button"
            onClick={requestClose}
          >
            <X aria-hidden="true" size={19} />
          </button>
        </header>

        <div className="view-editor-body">
          {error ? (
            <p className="inline-error" role="alert">
              {error}
            </p>
          ) : null}
          {!draft || !configuration ? (
            <ViewEditorLoading />
          ) : (
            <Suspense fallback={<ViewEditorLoading />}>
              <ViewPreview preview={preview} />
              <ViewEditorForm
                autoFocusName={!view}
                configuration={configuration}
                draft={draft}
                repository={repository}
                sourcePath={source?.path}
                onChange={setDraft}
                onComputedValidityChange={setComputedValid}
                onFilterValidityChange={setFilterValid}
              />
            </Suspense>
          )}
        </div>

        <footer className="view-editor-footer">
          {view ? (
            <button
              className="danger-text-action"
              disabled={status === "saving"}
              type="button"
              onClick={() => setConfirmation("delete")}
            >
              Delete view
            </button>
          ) : (
            <span />
          )}
          <div>
            <button
              className="text-action"
              disabled={status === "saving"}
              type="button"
              onClick={requestClose}
            >
              Cancel
            </button>
            <button
              className="save-view-action"
              disabled={!canSave}
              type="button"
              onClick={() => void save()}
            >
              {status === "saving" ? "Saving…" : "Save view"}
            </button>
          </div>
        </footer>
        {confirmation ? (
          <ViewEditorConfirmation
            action={confirmation}
            containerRef={confirmationRef}
            name={draft?.name || view?.name || "this view"}
            onCancel={() => setConfirmation(null)}
            onConfirm={() => {
              if (confirmation === "discard") onClose();
              else void remove();
            }}
          />
        ) : null}
      </section>
    </div>,
    document.body,
  );
}

function ViewPreview({ preview }: { preview: ViewDraftPreview }) {
  return (
    <section
      className="view-draft-preview"
      aria-labelledby="view-preview-title"
    >
      <div>
        <h2 id="view-preview-title">Preview</h2>
        <p>{previewLabel(preview)}</p>
      </div>
      {preview.tasks.length ? (
        <ol aria-label="Preview tasks">
          {preview.tasks.map((task) => (
            <li key={task.id}>{task.title}</li>
          ))}
        </ol>
      ) : preview.kind === "live" ? (
        <p className="view-preview-empty">No tasks match this draft.</p>
      ) : null}
    </section>
  );
}

function previewLabel(preview: ViewDraftPreview): string {
  if (preview.kind === "unavailable") return "Preview updates after saving";
  const count = preview.count ?? 0;
  return `${count} ${count === 1 ? "task" : "tasks"} ${
    preview.kind === "live" ? "match this draft" : "currently in this view"
  }`;
}

function ViewEditorConfirmation({
  action,
  containerRef,
  name,
  onCancel,
  onConfirm,
}: {
  action: "discard" | "delete";
  containerRef: RefObject<HTMLElement | null>;
  name: string;
  onCancel(): void;
  onConfirm(): void;
}) {
  const deleting = action === "delete";
  return (
    <div className="view-editor-confirmation-layer">
      <button
        aria-label="Cancel confirmation"
        className="view-editor-confirmation-scrim"
        type="button"
        onClick={onCancel}
      />
      <section
        aria-labelledby="view-editor-confirmation-title"
        className="view-editor-confirmation"
        ref={containerRef}
        role="alertdialog"
      >
        <h2 id="view-editor-confirmation-title">
          {deleting ? `Delete “${name}”?` : "Discard changes?"}
        </h2>
        <p>
          {deleting
            ? "This removes the saved view only. Your tasks won’t be deleted."
            : "Your changes to this view have not been saved."}
        </p>
        <div>
          <button className="text-action" type="button" onClick={onCancel}>
            {deleting ? "Cancel" : "Keep editing"}
          </button>
          <button
            className="danger-outline-action"
            type="button"
            onClick={onConfirm}
          >
            {deleting ? "Delete view" : "Discard changes"}
          </button>
        </div>
      </section>
    </div>
  );
}

function ViewEditorLoading() {
  return (
    <div aria-label="Opening view editor" className="view-editor-loading">
      <span />
      <span />
      <span />
    </div>
  );
}

function draftFingerprint(draft: EditableViewDraft | null): string {
  if (!draft) return "";
  return JSON.stringify({
    name: draft.name,
    renderer: draft.renderer,
    filter: draft.filter,
    computedProperties: draft.computedProperties,
    properties: draft.properties,
    sort: draft.sort,
    groupProperty: draft.groupProperty,
    groupDirection: draft.groupDirection,
    options: draft.options,
  });
}

function focusableControls(container: HTMLElement): HTMLElement[] {
  return [
    ...container.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((control) => !control.hidden);
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
