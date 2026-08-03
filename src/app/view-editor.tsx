import { X } from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";

import {
  createViewDocument,
  emptyViewDraft,
  readViewDraft,
  removeViewFromDocument,
  updateViewDocument,
  type EditableViewDraft,
} from "../domain/view-document";
import { loadViewEditorForm } from "./view-editor-loader";
import { useRepository } from "./repository-context";

import type { TaskView, TaskViewSourceDocument } from "../domain/view";
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
  const fingerprint = useMemo(() => draftFingerprint(draft), [draft]);
  const dirty =
    draft !== null && (source === null || fingerprint !== initialFingerprint);

  useEffect(() => {
    let active = true;
    void Promise.all([
      repository.taskConfiguration(),
      view ? repository.readViewSource(view.source.path) : null,
      repository.syncStatus(),
    ]).then(
      ([configuration, loadedSource, sync]) => {
        if (!active) return;
        const next = loadedSource
          ? readViewDraft(loadedSource, view!.id)
          : emptyViewDraft(
              sync.mode === "replicated" ? "mdbase-cel" : "obsidian-bases",
            );
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
    if (!draft || !view) return;
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
    return () => {
      document.body.style.overflow = previousOverflow;
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

  const title = view ? "Edit view" : "Create a view";
  const canSave =
    Boolean(draft?.name.trim()) &&
    filterValid &&
    computedValid &&
    status === "ready" &&
    dirty;

  return (
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
            <p className="eyebrow">{view ? "Saved view" : "New saved view"}</p>
            <h1 id="view-editor-title">{title}</h1>
            <small>
              {view
                ? "Choose what this view shows and how it is arranged."
                : "Create a focused place for the tasks you need."}
            </small>
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
              <ViewEditorForm
                autoFocusName={!view}
                configuration={configuration}
                draft={draft}
                repository={repository}
                onChange={setDraft}
                onComputedValidityChange={setComputedValid}
                onFilterValidityChange={setFilterValid}
              />
              {source?.path ? (
                <details className="view-source-details">
                  <summary>View file</summary>
                  <code>{source.path}</code>
                </details>
              ) : null}
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
    </div>
  );
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
          {deleting ? "Delete view?" : "Discard changes?"}
        </h2>
        <p>
          {deleting
            ? `“${name}” will be removed from its view file.`
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
