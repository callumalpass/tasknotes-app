import {
  Camera,
  Check,
  FileCode2,
  FileImage,
  ImagePlus,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CornerDownRight,
  CornerUpLeft,
  FileCheck2,
  GripVertical,
  Link2,
  ListChecks,
  ListTodo,
  ListTree,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Square,
  SquareCheckBig,
  StickyNote,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useLayoutEffect,
  useState,
  type DragEvent as ReactDragEvent,
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
  scratchSubtreeEnd,
  scratchpadPreview,
  serializeScratchNodes,
  visibleScratchNodes,
  type ScratchDropPlacement,
  type ScratchNode,
  type ScratchpadDocument,
  type StartNewScratchpadInput,
  type StartNewScratchpadResult,
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
import type { TaskRepository } from "../application/ports/task-repository";
import type { ScratchFeedItem } from "../domain/scratch-feed";
import type { ScratchImage } from "../domain/scratch-image";
import { scratchFeedKey } from "../domain/scratch-feed";
import { ScratchImageService } from "../application/scratch-images/scratch-image-service";
import { TaskActions } from "../components/task-actions";

const MarkdownSourceEditor = lazy(async () => ({
  default: (await import("../components/markdown-source-editor"))
    .MarkdownSourceEditor,
}));

interface DragState {
  sourceId: string;
  targetId?: string;
  placement?: ScratchDropPlacement;
}

interface ReviewItem {
  id: string;
  text: string;
  depth: number;
}

interface ReviewResult {
  state: "creating" | "created" | "error";
  message?: string;
  task?: Task;
}

interface ScratchpadNotice {
  message: string;
  tasks?: Task[];
}

export function ScratchpadScreen({
  onOpenTask,
}: {
  onOpenTask(task: Task): void;
}) {
  const { repository } = useRepository();
  const [currentDocument, setCurrentDocument] = useState<ScratchpadDocument>();
  const [historyItems, setHistoryItems] = useState<ScratchFeedItem[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [collapsedImageIds, setCollapsedImageIds] = useState<Set<string>>(
    new Set(),
  );
  const [collapseStorageKey, setCollapseStorageKey] = useState<string>();
  const [collapseStateLoaded, setCollapseStateLoaded] = useState(false);
  const [nextCursor, setNextCursor] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [startingNew, setStartingNew] = useState(false);
  const [imageCaptureOpen, setImageCaptureOpen] = useState(false);
  const [addingImages, setAddingImages] = useState(false);
  const [draggingImages, setDraggingImages] = useState(false);
  const [error, setError] = useState("");
  const [streamNotice, setStreamNotice] = useState("");
  const flushers = useRef(new Map<string, () => Promise<unknown>>());
  const imageActionRef = useRef<HTMLButtonElement | null>(null);
  const historyRef = useRef<HTMLDivElement | null>(null);
  const prependAnchor = useRef<
    { height: number; top: number; wasAtBottom: boolean } | undefined
  >(undefined);
  const revealBottom = useRef(true);
  const stickToBottom = useRef(true);
  const touchY = useRef<number | undefined>(undefined);
  const dragDepth = useRef(0);
  const imageService = useMemo(
    () => new ScratchImageService(repository),
    [repository],
  );

  const loadHistory = useCallback(async () => {
    if (!repository.listScratchFeed && !repository.listScratchpads) {
      setHistoryLoaded(true);
      return;
    }
    setLoadingHistory(true);
    try {
      let items: ScratchFeedItem[];
      let cursor: string | undefined;
      if (repository.listScratchFeed) {
        const page = await repository.listScratchFeed();
        items = page.items;
        cursor = page.nextCursor;
      } else {
        const page = await repository.listScratchpads!();
        const current = page.documents.find(
          (document) => document.state === "active",
        );
        if (!current) throw new Error("The current scratchpad is unavailable.");
        items = page.documents
          .filter((document) => document.id !== current.id)
          .map((document) => ({ kind: "scratchpad", ...document }));
        cursor = undefined;
      }
      const history = historyRef.current;
      if (history)
        prependAnchor.current = {
          height: history.scrollHeight,
          top: history.scrollTop,
          wasAtBottom:
            history.scrollHeight - history.clientHeight - history.scrollTop <=
            2,
        };
      setHistoryItems(items);
      setNextCursor(cursor);
      setHistoryLoaded(true);
    } catch (reason) {
      setError(`Previous notes could not be loaded. ${message(reason)}`);
    } finally {
      setLoadingHistory(false);
    }
  }, [repository]);

  const loadStream = useCallback(async () => {
    if (
      !repository.getActiveScratchpad &&
      !repository.listScratchFeed &&
      !repository.listScratchpads
    ) {
      setError("Scratchpad storage is not available for this collection.");
      setLoading(false);
      return;
    }
    try {
      if (repository.getActiveScratchpad) {
        const current = await repository.getActiveScratchpad();
        setCurrentDocument(current);
        setError("");
        setLoading(false);
        window.setTimeout(() => void loadHistory(), 0);
        return;
      }
      if (repository.listScratchFeed) {
        const page = await repository.listScratchFeed();
        setCurrentDocument(page.current);
        setHistoryItems(page.items);
        setNextCursor(page.nextCursor);
      } else {
        const page = await repository.listScratchpads!();
        const current = page.documents.find(
          (document) => document.state === "active",
        );
        if (!current) throw new Error("The current scratchpad is unavailable.");
        setCurrentDocument(current);
        setHistoryItems(
          page.documents
            .filter((document) => document.id !== current.id)
            .map((document) => ({ kind: "scratchpad", ...document })),
        );
        setNextCursor(undefined);
      }
      setHistoryLoaded(true);
      setError("");
    } catch (reason) {
      setError(message(reason));
    } finally {
      setLoading(false);
    }
  }, [loadHistory, repository]);

  useEffect(() => {
    globalThis.document.documentElement.classList.add("scratchpad-route");
    return () =>
      globalThis.document.documentElement.classList.remove("scratchpad-route");
  }, []);

  useEffect(() => {
    let active = true;
    void repository
      .collectionInfo()
      .then((info) => {
        if (!active) return;
        const identity = info.id || info.location || info.name;
        const key = `tasknotes:scratchpad-collapse:${identity}`;
        const stored = readScratchpadCollapseState(key);
        setExpandedIds(new Set(stored.expandedDocuments));
        setCollapsedImageIds(new Set(stored.collapsedImages));
        setCollapseStorageKey(key);
        setCollapseStateLoaded(true);
      })
      .catch(() => {
        if (active) setCollapseStateLoaded(false);
      });
    return () => {
      active = false;
    };
  }, [repository]);

  useEffect(() => {
    if (!collapseStateLoaded || !collapseStorageKey) return;
    try {
      localStorage.setItem(
        collapseStorageKey,
        JSON.stringify({
          expandedDocuments: [...expandedIds],
          collapsedImages: [...collapsedImageIds],
        }),
      );
    } catch {
      // Collapse preferences are optional local UI state.
    }
  }, [collapseStateLoaded, collapseStorageKey, collapsedImageIds, expandedIds]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadStream(), 0);
    return () => window.clearTimeout(timeout);
  }, [loadStream]);

  async function toggleDocument(document: ScratchpadDocument) {
    if (expandedIds.has(document.id)) {
      try {
        await flushers.current.get(document.id)?.();
      } catch (reason) {
        setError(message(reason));
        return;
      }
      setExpandedIds((current) => {
        const next = new Set(current);
        next.delete(document.id);
        return next;
      });
    } else {
      setExpandedIds((current) => new Set(current).add(document.id));
    }
  }

  async function startNew() {
    const current = currentDocument;
    if (
      !current ||
      startingNew ||
      (!repository.startNewScratchpad && !repository.archiveScratchpad)
    )
      return;
    setStartingNew(true);
    setError("");
    try {
      const flushed = (await flushers.current.get(current.id)?.()) as
        ScratchpadDocument | undefined;
      const latest = flushed ?? current;
      const result = await transitionToNewScratchpad(repository, {
        id: latest.id,
        path: latest.path,
        revision: latest.revision,
        baseBody: latest.body,
        body: latest.body,
      });
      revealBottom.current = true;
      setCurrentDocument(result.current);
      setHistoryItems((existing) => [
        { kind: "scratchpad", ...result.previous },
        ...existing.filter((item) => item.id !== current.id),
      ]);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setStartingNew(false);
    }
  }

  const historicalItems = [...historyItems].reverse();

  useLayoutEffect(() => {
    const element = historyRef.current;
    if (!element) return;
    const pending = prependAnchor.current;
    if (pending) {
      stickToBottom.current = pending.wasAtBottom;
      element.scrollTop = pending.wasAtBottom
        ? element.scrollHeight
        : pending.top + element.scrollHeight - pending.height;
      prependAnchor.current = undefined;
      return;
    }
    if (revealBottom.current) {
      stickToBottom.current = true;
      element.scrollTop = element.scrollHeight;
      revealBottom.current = false;
    }
  }, [currentDocument, historyItems]);

  useLayoutEffect(() => {
    const element = historyRef.current;
    if (!element || loading) return;
    const pinToBottom = () => {
      if (stickToBottom.current) element.scrollTop = element.scrollHeight;
    };
    pinToBottom();
    if (typeof ResizeObserver === "undefined") return;

    const observed = new Set<Element>();
    const resizeObserver = new ResizeObserver(pinToBottom);
    resizeObserver.observe(element);
    const observeChildren = () => {
      for (const child of element.children) {
        if (observed.has(child)) continue;
        observed.add(child);
        resizeObserver.observe(child);
      }
    };
    observeChildren();
    const mutationObserver = new MutationObserver(() => {
      observeChildren();
      pinToBottom();
    });
    mutationObserver.observe(element, { childList: true });
    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, [loading]);

  const addImages = useCallback(
    async (files: readonly File[]) => {
      if (!files.length || addingImages) return;
      setAddingImages(true);
      setError("");
      setStreamNotice(
        files.length === 1 ? "Adding image…" : `Adding ${files.length} images…`,
      );
      const results = await Promise.allSettled(
        files.map((file) => imageService.add(file)),
      );
      const created = results
        .flatMap((result) =>
          result.status === "fulfilled" ? [result.value] : [],
        )
        .filter(
          (image, index, images) =>
            images.findIndex((candidate) => candidate.id === image.id) ===
            index,
        );
      const failures = results.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      if (created.length) {
        revealBottom.current = true;
        setHistoryItems((items) => [
          ...created,
          ...items.filter(
            (item) => !created.some((image) => image.id === item.id),
          ),
        ]);
      }
      setStreamNotice(
        created.length
          ? created.length === 1
            ? "Image added"
            : `${created.length} images added`
          : "",
      );
      if (failures.length) {
        setImageCaptureOpen(true);
        setError(
          `${message(failures[0])}${created.length ? ` ${created.length} ${created.length === 1 ? "image was" : "images were"} added.` : ""}`,
        );
      } else if (created.length) {
        setImageCaptureOpen(false);
      }
      setAddingImages(false);
    },
    [addingImages, imageService],
  );

  useEffect(() => {
    if (!imageCaptureOpen) return;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setImageCaptureOpen(false);
      imageActionRef.current?.focus();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [imageCaptureOpen]);

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const images = [...(event.clipboardData?.items ?? [])]
        .filter(
          (item) => item.kind === "file" && item.type.startsWith("image/"),
        )
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file));
      if (!images.length) return;
      event.preventDefault();
      void addImages(images);
    };
    const surface = historyRef.current?.closest(".scratchpad-screen");
    surface?.addEventListener("paste", handlePaste as EventListener);
    return () =>
      surface?.removeEventListener("paste", handlePaste as EventListener);
  }, [addImages, loading]);

  function hasDraggedFiles(event: ReactDragEvent<HTMLElement>) {
    return (
      [...event.dataTransfer.items].some((item) => item.kind === "file") ||
      [...event.dataTransfer.types].includes("Files")
    );
  }

  function handleDragEnter(event: ReactDragEvent<HTMLElement>) {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDraggingImages(true);
  }

  function handleDragOver(event: ReactDragEvent<HTMLElement>) {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(event: ReactDragEvent<HTMLElement>) {
    if (!hasDraggedFiles(event)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (!dragDepth.current) setDraggingImages(false);
  }

  function handleDrop(event: ReactDragEvent<HTMLElement>) {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDraggingImages(false);
    void addImages([...event.dataTransfer.files]);
  }

  if (loading)
    return (
      <section className="screen scratchpad-screen" aria-busy="true">
        <span className="visually-hidden" role="status">
          Opening current note…
        </span>
      </section>
    );

  const editor = (document: ScratchpadDocument, isCurrent = false) => (
    <ScratchpadDocumentEditor
      key={document.id}
      initialDocument={document}
      isCurrent={isCurrent}
      onOpenTask={onOpenTask}
      onDocumentUpdated={(updated) => {
        if (updated.id === currentDocument?.id) setCurrentDocument(updated);
        else
          setHistoryItems((items) =>
            items.map((item) =>
              item.kind === "scratchpad" && item.id === updated.id
                ? { kind: "scratchpad", ...updated }
                : item,
            ),
          );
      }}
      registerFlusher={(flush) => {
        if (flush) flushers.current.set(document.id, flush);
        else flushers.current.delete(document.id);
      }}
    />
  );

  return (
    <section
      className="screen scratchpad-screen"
      aria-labelledby="scratchpad-stream-title"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {draggingImages ? (
        <div className="scratchpad-drop-overlay" role="status">
          <ImagePlus aria-hidden="true" size={30} />
          <strong>Drop images to add them</strong>
        </div>
      ) : null}
      {streamNotice ? (
        <div className="scratchpad-notice" role="status">
          <span>{streamNotice}</span>
          <button
            aria-label="Dismiss"
            type="button"
            onClick={() => setStreamNotice("")}
          >
            <X aria-hidden="true" size={16} />
          </button>
        </div>
      ) : null}
      {error ? (
        <div className="scratchpad-error" role="alert">
          {error}
          <button type="button" onClick={() => void loadStream()}>
            Reload
          </button>
        </div>
      ) : null}
      <div className="scratchpad-document-stream">
        <div
          className="scratchpad-history-scroll"
          ref={historyRef}
          onPointerDown={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            if (event.clientX >= bounds.right - 20)
              stickToBottom.current = false;
          }}
          onScroll={(event) => {
            const element = event.currentTarget;
            if (
              element.scrollHeight - element.clientHeight - element.scrollTop <=
              2
            )
              stickToBottom.current = true;
          }}
          onTouchEnd={() => {
            touchY.current = undefined;
          }}
          onTouchMove={(event) => {
            const nextY = event.touches[0]?.clientY;
            if (nextY === undefined) return;
            if (touchY.current !== undefined && nextY > touchY.current + 1)
              stickToBottom.current = false;
            touchY.current = nextY;
          }}
          onTouchStart={(event) => {
            touchY.current = event.touches[0]?.clientY;
          }}
          onWheel={(event) => {
            if (event.deltaY < 0) stickToBottom.current = false;
          }}
        >
          {nextCursor ? (
            <button
              className="scratchpad-load-older"
              disabled={loadingOlder}
              type="button"
              onClick={() => {
                if (!repository.listScratchFeed) return;
                const history = historyRef.current;
                if (history)
                  prependAnchor.current = {
                    height: history.scrollHeight,
                    top: history.scrollTop,
                    wasAtBottom:
                      history.scrollHeight -
                        history.clientHeight -
                        history.scrollTop <=
                      2,
                  };
                setLoadingOlder(true);
                void repository
                  .listScratchFeed({ cursor: nextCursor })
                  .then((page) => {
                    setHistoryItems((current) => [
                      ...current,
                      ...page.items.filter(
                        (item) =>
                          !current.some(
                            (entry) =>
                              scratchFeedKey(entry) === scratchFeedKey(item),
                          ),
                      ),
                    ]);
                    setNextCursor(page.nextCursor);
                  })
                  .catch((reason) => setError(message(reason)))
                  .finally(() => setLoadingOlder(false));
              }}
            >
              {loadingOlder ? "Loading…" : "Load older"}
            </button>
          ) : null}
          <div
            aria-busy={loadingHistory}
            aria-label="Scratchpad history"
            className={`scratchpad-history${historyLoaded ? " is-loaded" : ""}`}
          >
            {loadingHistory ? (
              <span className="visually-hidden" role="status">
                Loading previous notes…
              </span>
            ) : null}
            {historicalItems.map((item) => {
              if (item.kind === "image")
                return (
                  <ScratchImageCard
                    collapsed={collapsedImageIds.has(item.id)}
                    image={item}
                    key={scratchFeedKey(item)}
                    repository={repository}
                    onCollapsedChange={(collapsed) =>
                      setCollapsedImageIds((current) => {
                        const next = new Set(current);
                        if (collapsed) next.add(item.id);
                        else next.delete(item.id);
                        return next;
                      })
                    }
                    onRemoved={() =>
                      setHistoryItems((items) =>
                        items.filter(
                          (candidate) =>
                            scratchFeedKey(candidate) !== scratchFeedKey(item),
                        ),
                      )
                    }
                  />
                );
              const document = item;
              const expanded = expandedIds.has(document.id);
              return (
                <article
                  className={`scratchpad-document${expanded ? " is-expanded" : " is-collapsed"}`}
                  data-feed-key={scratchFeedKey(item)}
                  key={scratchFeedKey(item)}
                >
                  <button
                    className={`scratchpad-document-disclosure${document.title && !expanded ? " has-title" : ""}`}
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => void toggleDocument(document)}
                  >
                    <span>
                      {document.title && !expanded ? (
                        <strong>{document.title}</strong>
                      ) : null}
                      <time dateTime={document.dateCreated}>
                        {new Date(document.dateCreated).toLocaleDateString()}
                      </time>
                    </span>
                    {!expanded && document.title ? (
                      <small>{scratchpadPreview(document)}</small>
                    ) : null}
                    {expanded ? (
                      <ChevronDown
                        aria-hidden="true"
                        className="scratchpad-document-chevron"
                        size={18}
                      />
                    ) : (
                      <ChevronRight
                        aria-hidden="true"
                        className="scratchpad-document-chevron"
                        size={18}
                      />
                    )}
                  </button>
                  {expanded ? editor(document) : null}
                </article>
              );
            })}
          </div>
          {currentDocument ? (
            <div aria-hidden="true" className="scratchpad-current-spacer" />
          ) : null}
          <header className="scratchpad-stream-header">
            <h1 className="visually-hidden" id="scratchpad-stream-title">
              Scratchpad
            </h1>
            <div className="scratchpad-stream-actions">
              <button
                aria-label="Add image"
                aria-expanded={imageCaptureOpen}
                aria-controls="scratchpad-image-capture"
                className="text-action scratchpad-image-action"
                disabled={!repository.files || !repository.createScratchImage}
                ref={imageActionRef}
                title="Add image"
                type="button"
                onClick={() => setImageCaptureOpen((open) => !open)}
              >
                <ImagePlus aria-hidden="true" size={18} />
              </button>
              <button
                aria-label="New note"
                className="text-action scratchpad-new-action"
                type="button"
                onClick={() => void startNew()}
                disabled={
                  startingNew ||
                  (!repository.startNewScratchpad &&
                    !repository.archiveScratchpad)
                }
              >
                <Plus aria-hidden="true" size={18} />
                <span>{startingNew ? "Starting…" : "New note"}</span>
              </button>
            </div>
          </header>
          {imageCaptureOpen ? (
            <section
              aria-labelledby="scratchpad-image-capture-title"
              className="scratchpad-image-capture"
              id="scratchpad-image-capture"
            >
              <header>
                <div>
                  <strong id="scratchpad-image-capture-title">Add image</strong>
                  <p>
                    Drop images here, paste them, upload files, or take a photo.
                  </p>
                </div>
                <button
                  aria-label="Close image capture"
                  className="icon-action"
                  disabled={addingImages}
                  type="button"
                  onClick={() => {
                    setImageCaptureOpen(false);
                    imageActionRef.current?.focus();
                  }}
                >
                  <X aria-hidden="true" size={18} />
                </button>
              </header>
              <div className="scratchpad-image-capture-actions">
                <label
                  aria-disabled={addingImages}
                  className="outline-action scratchpad-image-picker"
                >
                  <Upload aria-hidden="true" size={18} />
                  {addingImages ? "Adding…" : "Upload images"}
                  <input
                    accept="image/*"
                    className="visually-hidden"
                    disabled={addingImages}
                    multiple
                    type="file"
                    onChange={(event) => {
                      void addImages([...(event.target.files ?? [])]);
                      event.target.value = "";
                    }}
                  />
                </label>
                <label
                  aria-disabled={addingImages}
                  className="outline-action scratchpad-image-picker scratchpad-camera-picker"
                >
                  <Camera aria-hidden="true" size={18} /> Take photo
                  <input
                    accept="image/*"
                    capture="environment"
                    className="visually-hidden"
                    disabled={addingImages}
                    type="file"
                    onChange={(event) => {
                      void addImages([...(event.target.files ?? [])]);
                      event.target.value = "";
                    }}
                  />
                </label>
              </div>
            </section>
          ) : null}
          {currentDocument ? (
            <article className="scratchpad-current-document">
              {editor(currentDocument, true)}
            </article>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function ScratchImageCard({
  collapsed,
  image,
  repository,
  onCollapsedChange,
  onRemoved,
}: {
  collapsed: boolean;
  image: ScratchImage;
  repository: TaskRepository;
  onCollapsedChange(collapsed: boolean): void;
  onRemoved(): void;
}) {
  const [source, setSource] = useState<string>();
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">(
    repository.files ? "loading" : "missing",
  );
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    const store = repository.files;
    if (!store) return;
    const controller = new AbortController();
    let url: string | undefined;
    void store
      .list({
        folder: image.file.slice(0, image.file.lastIndexOf("/")),
        signal: controller.signal,
      })
      .then((files) => files.find((file) => file.path === image.file))
      .then(async (file) => {
        if (
          !file ||
          file.size !== image.size ||
          file.contentDigest !== image.digest ||
          file.mediaClass !== "image"
        ) {
          setState("missing");
          return;
        }
        const blob = await store.download(file, { signal: controller.signal });
        url = URL.createObjectURL(blob);
        setSource(url);
        setState("ready");
      })
      .catch((reason) => {
        if ((reason as Error).name !== "AbortError") setState("error");
      });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [image, repository]);

  async function remove() {
    if (!repository.removeScratchImage || removing) return;
    if (
      !window.confirm(
        "Remove this image card from Scratchpad? The image file will be kept.",
      )
    )
      return;
    setRemoving(true);
    try {
      await repository.removeScratchImage(image);
      onRemoved();
    } catch {
      setState("error");
      setRemoving(false);
    }
  }

  return (
    <article
      className="scratch-image-card"
      data-feed-key={scratchFeedKey(image)}
    >
      {!collapsed ? (
        <div
          className="scratch-image-frame"
          style={
            image.width && image.height
              ? { aspectRatio: `${image.width} / ${image.height}` }
              : undefined
          }
        >
          {state === "ready" && source ? (
            <img
              alt={image.caption || "Pasted Scratchpad image"}
              src={source}
            />
          ) : (
            <div
              className="scratch-image-placeholder"
              role={state === "error" ? "alert" : "status"}
            >
              <FileImage aria-hidden="true" size={24} />
              {state === "loading"
                ? "Loading image…"
                : state === "missing"
                  ? "Image file is unavailable"
                  : "Image could not be loaded"}
            </div>
          )}
        </div>
      ) : null}
      <footer>
        <button
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand image" : "Collapse image"}
          className="scratch-image-disclosure"
          type="button"
          onClick={() => onCollapsedChange(!collapsed)}
        >
          {collapsed ? (
            <ChevronRight aria-hidden="true" size={18} />
          ) : (
            <ChevronDown aria-hidden="true" size={18} />
          )}
          <FileImage aria-hidden="true" size={17} />
          <time dateTime={image.dateCreated}>
            {new Date(image.dateCreated).toLocaleString()}
          </time>
        </button>
        <button
          aria-label="Remove image card"
          disabled={removing || !repository.removeScratchImage}
          type="button"
          onClick={() => void remove()}
        >
          <Trash2 aria-hidden="true" size={17} />{" "}
          {removing ? "Removing…" : "Remove"}
        </button>
      </footer>
    </article>
  );
}

function ScratchpadDocumentEditor({
  onOpenTask,
  initialDocument,
  isCurrent,
  registerFlusher,
  onDocumentUpdated,
}: {
  onOpenTask(task: Task): void;
  initialDocument: ScratchpadDocument;
  isCurrent: boolean;
  registerFlusher(flush: (() => Promise<unknown>) | null): void;
  onDocumentUpdated(document: ScratchpadDocument): void;
}) {
  const { repository, configuration, createTask, updateTask } = useRepository();
  const [document, setDocument] = useState<ScratchpadDocument | null>(null);
  const [nodes, setNodes] = useState<ScratchNode[]>([]);
  const [linkedTasks, setLinkedTasks] = useState<Map<string, Task>>(new Map());
  const [source, setSource] = useState(initialDocument.body);
  const [title, setTitle] = useState(initialDocument.title ?? "");
  const [editorMode, setEditorMode] = useState<"outline" | "markdown">(
    isOutlineCompatible(initialDocument.body) ? "outline" : "markdown",
  );
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
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [selectedReviewIds, setSelectedReviewIds] = useState<Set<string>>(
    new Set(),
  );
  const [reviewResults, setReviewResults] = useState<
    Record<string, ReviewResult>
  >({});
  const [reviewProcessing, setReviewProcessing] = useState(false);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [convertingId, setConvertingId] = useState<string>();
  const [notice, setNotice] = useState<ScratchpadNotice | null>(null);
  const initialDocumentRef = useRef(initialDocument);
  const documentRef = useRef<ScratchpadDocument | null>(null);
  const nodesRef = useRef<ScratchNode[]>([]);
  const sourceRef = useRef(initialDocument.body);
  const titleRef = useRef(initialDocument.title ?? "");
  const rowMenuRef = useRef<HTMLDivElement | null>(null);
  const editorModeRef = useRef<"outline" | "markdown">(editorMode);
  const saveTail = useRef<Promise<unknown>>(Promise.resolve());
  const autosaveSuspended = useRef(false);
  const focusAfterRender = useRef<{ id: string; cursor?: number } | undefined>(
    undefined,
  );

  useEffect(() => {
    const timeout = window.setTimeout(preloadTaskCapture, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = initialDocumentRef.current;
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
      const visible = [...hydrated];
      const last = visible.at(-1);
      if (!last || last.kind === "task" || last.text.trim())
        visible.push(createScratchNode());
      const mode = isOutlineCompatible(next.body) ? "outline" : "markdown";
      documentRef.current = next;
      nodesRef.current = visible;
      sourceRef.current = next.body;
      titleRef.current = next.title ?? "";
      editorModeRef.current = mode;
      setDocument(next);
      setNodes(visible);
      setLinkedTasks(new Map(tasks.map((task) => [task.id, task])));
      setSource(next.body);
      setTitle(next.title ?? "");
      setEditorMode(mode);
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

  const persistBody = useCallback(
    (body: string, nextTitle = titleRef.current) => {
      const current = documentRef.current;
      if (!current || !repository.saveScratchpad)
        return Promise.reject(new Error("Scratchpad storage is unavailable."));
      const normalizedTitle = nextTitle.trim();
      setSaveState("saving");
      const operation = saveTail.current
        .catch(() => undefined)
        .then(async () => {
          const latest = documentRef.current;
          if (!latest) throw new Error("The scratchpad is not open.");
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
          sourceRef.current = saved.body;
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
        });
      saveTail.current = operation;
      return operation;
    },
    [onDocumentUpdated, repository],
  );

  const persist = useCallback(
    (nextNodes: readonly ScratchNode[]) => persistBody(scratchBody(nextNodes)),
    [persistBody],
  );

  const flush = useCallback(
    () =>
      documentRef.current
        ? editorModeRef.current === "markdown"
          ? persistBody(sourceRef.current)
          : persist(nodesRef.current)
        : Promise.resolve(initialDocumentRef.current),
    [persist, persistBody],
  );

  useEffect(() => {
    registerFlusher(flush);
    return () => registerFlusher(null);
  }, [flush, registerFlusher]);

  useEffect(() => {
    if (
      !document ||
      editorMode !== "outline" ||
      reviewProcessing ||
      autosaveSuspended.current
    )
      return;
    const body = scratchBody(nodes);
    if (body === documentRef.current?.body) return;
    const timeout = window.setTimeout(() => {
      if (!autosaveSuspended.current)
        void persist(nodes).catch(() => undefined);
    }, 260);
    return () => window.clearTimeout(timeout);
  }, [document, editorMode, nodes, persist, reviewProcessing]);

  useEffect(() => {
    if (
      !document ||
      editorMode !== "markdown" ||
      autosaveSuspended.current ||
      source === documentRef.current?.body
    )
      return;
    const timeout = window.setTimeout(() => {
      if (!autosaveSuspended.current)
        void persistBody(source).catch(() => undefined);
    }, 260);
    return () => window.clearTimeout(timeout);
  }, [document, editorMode, persistBody, source]);

  useEffect(() => {
    if (
      !document ||
      autosaveSuspended.current ||
      title.trim() === (documentRef.current?.title?.trim() ?? "")
    )
      return;
    const timeout = window.setTimeout(() => {
      if (!autosaveSuspended.current) {
        const body =
          editorModeRef.current === "markdown"
            ? sourceRef.current
            : scratchBody(nodesRef.current);
        void persistBody(body, title).catch(() => undefined);
      }
    }, 260);
    return () => window.clearTimeout(timeout);
  }, [document, persistBody, title]);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    sourceRef.current = source;
  }, [source]);

  useEffect(() => {
    editorModeRef.current = editorMode;
  }, [editorMode]);

  useLayoutEffect(() => {
    if (!isCurrent || loading || editorMode !== "outline") return;
    const last = nodesRef.current.at(-1);
    if (!last) return;
    const input = globalThis.document.querySelector<HTMLInputElement>(
      `[data-scratch-input="${CSS.escape(`${documentRef.current?.id ?? initialDocument.id}:${last.id}`)}"]`,
    );
    input?.focus({ preventScroll: true });
  }, [editorMode, initialDocument.id, isCurrent, loading]);

  useLayoutEffect(() => {
    const menu = rowMenuRef.current;
    if (!menu || !menuId) return;
    const row = menu.closest(".scratchpad-row");
    const scroller = menu.closest(".scratchpad-history-scroll");
    if (!row) return;
    const rowBounds = row.getBoundingClientRect();
    const scrollBounds = scroller?.getBoundingClientRect();
    const boundaryTop = Math.max(0, scrollBounds?.top ?? 0);
    const boundaryBottom = Math.min(
      window.innerHeight,
      scrollBounds?.bottom ?? window.innerHeight,
    );
    const roomAbove = rowBounds.top - boundaryTop;
    const roomBelow = boundaryBottom - rowBounds.bottom;
    menu.classList.toggle(
      "opens-up",
      roomBelow < menu.offsetHeight + 8 && roomAbove > roomBelow,
    );
  }, [menuId]);

  useEffect(() => {
    const request = focusAfterRender.current;
    if (!request) return;
    focusAfterRender.current = undefined;
    const input = globalThis.document.querySelector<HTMLInputElement>(
      `[data-scratch-input="${CSS.escape(`${documentRef.current?.id ?? "scratchpad"}:${request.id}`)}"]`,
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

  function changeDepth(node: ScratchNode, direction: -1 | 1) {
    focusAfterRender.current = { id: node.id };
    updateNodes(changeScratchDepth(nodesRef.current, node.id, direction));
    selectionFeedback();
  }

  function canIndent(node: ScratchNode): boolean {
    const index = nodesRef.current.findIndex(
      (candidate) => candidate.id === node.id,
    );
    const previous = nodesRef.current[index - 1];
    return Boolean(previous && node.depth <= previous.depth);
  }

  function addChild(node: ScratchNode) {
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
    setCollapsedIds((current) => {
      if (!current.has(node.id)) return current;
      const next = new Set(current);
      next.delete(node.id);
      return next;
    });
  }

  async function convertNode(id: string) {
    if (convertingId || reviewProcessing) return;
    setConvertingId(id);
    setError("");
    try {
      const converted = await createTaskForNode(nodesRef.current, id);
      updateNodes(converted.nodes);
      await persist(converted.nodes);
      await linkExistingChildren(converted.nodes, id, converted.task);
      successFeedback();
      setNotice({
        message: `Created “${converted.task.title}”`,
        tasks: [converted.task],
      });
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
    const completedStatus = node.completed
      ? configuration.statuses.find((status) => status.isCompleted)
      : undefined;
    if (node.completed && !completedStatus)
      throw new Error(
        "This collection does not define a completed task status.",
      );
    const createInput = {
      ...result.input,
      ...(projects.length ? { projects } : {}),
    };
    if (completedStatus) delete createInput.status;
    const createdTask = await createTask(createInput);
    const task = completedStatus
      ? await updateTask(createdTask.id, { status: completedStatus.value })
      : createdTask;
    setLinkedTasks((current) => new Map(current).set(task.id, task));
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
      nodes: source.map((candidate) => {
        if (candidate.id !== id) return candidate;
        const converted = { ...candidate };
        delete converted.completed;
        return {
          ...converted,
          kind: "task" as const,
          text: task.title,
          link,
          taskId: task.id,
        };
      }),
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

  function openReview() {
    const items = nodesRef.current
      .filter((node) => node.kind === "draft" && node.text.trim())
      .map(({ id, text, depth }) => ({ id, text, depth }));
    setReviewItems(items);
    setSelectedReviewIds(new Set(items.map((item) => item.id)));
    setReviewResults({});
    setReviewOpen(true);
  }

  function toggleReviewBranch(id: string) {
    const source = nodesRef.current;
    const index = source.findIndex((node) => node.id === id);
    if (index < 0) return;
    const branchIds = source
      .slice(index, scratchSubtreeEnd(source, index))
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
    const completed = new Map<string, Task>();
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
      try {
        let working = nodesRef.current;
        const currentNode = working.find((node) => node.id === item.id);
        if (currentNode?.kind === "draft") {
          const converted = await createTaskForNode(working, item.id);
          working = converted.nodes;
          createdTask = converted.task;
          updateNodes(working);
        } else if (currentNode?.kind === "task") {
          createdTask ??= (await resolveLinkedTask(currentNode)) ?? undefined;
        } else {
          throw new Error("This draft is no longer in the scratchpad.");
        }
        if (!createdTask)
          throw new Error("The created TaskNote could not be found.");
        await persist(working);
        await linkExistingChildren(working, item.id, createdTask);
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
      message: `Created ${tasks.length} task ${tasks.length === 1 ? "note" : "notes"}`,
      tasks,
    });
    successFeedback();
  }

  async function changeEditorMode(nextMode: "outline" | "markdown") {
    if (nextMode === editorMode) return;
    setError("");
    try {
      if (nextMode === "markdown") {
        const latest = await persist(nodesRef.current);
        sourceRef.current = latest.body;
        editorModeRef.current = "markdown";
        setSource(latest.body);
        setEditorMode("markdown");
        return;
      }

      const latest = await persistBody(sourceRef.current);
      if (!isOutlineCompatible(latest.body)) {
        setError(
          "This Markdown contains blocks the outline cannot represent. It is saved; keep editing it as Markdown.",
        );
        return;
      }
      const parsed = parseScratchBody(latest.body);
      const last = parsed.at(-1);
      if (!last || last.kind === "task" || last.text.trim())
        parsed.push(createScratchNode());
      nodesRef.current = parsed;
      editorModeRef.current = "outline";
      setNodes(parsed);
      setEditorMode("outline");
    } catch (reason) {
      setError(message(reason));
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
      <section className="scratchpad-editor" aria-busy="true">
        <div className="scratchpad-loading" />
      </section>
    );

  const drafts = nodes.filter(
    (node) => node.kind === "draft" && node.text.trim(),
  ).length;
  const visibleNodes = visibleScratchNodes(nodes, collapsedIds);
  const failedReviewCount = Object.values(reviewResults).filter(
    (result) => result.state === "error",
  ).length;
  const selectedReviewCount = reviewItems.filter(
    (item) =>
      selectedReviewIds.has(item.id) &&
      reviewResults[item.id]?.state !== "created",
  ).length;

  return (
    <section
      className="scratchpad-editor"
      aria-label={`Editor for ${document?.title || (document?.state === "active" ? "current scratchpad" : "scratchpad")}`}
    >
      <div className="scratchpad-title-row">
        <input
          aria-label="Note title"
          maxLength={160}
          placeholder="Add title"
          type="text"
          value={title}
          onBlur={() => {
            const trimmed = title.trim();
            titleRef.current = trimmed;
            setTitle(trimmed);
          }}
          onChange={(event) => {
            titleRef.current = event.target.value;
            setTitle(event.target.value);
          }}
        />
        <span className="scratchpad-title-meta">
          {isCurrent ? <small>Current note</small> : null}
          <time dateTime={document?.dateCreated ?? initialDocument.dateCreated}>
            {new Date(
              document?.dateCreated ?? initialDocument.dateCreated,
            ).toLocaleDateString()}
          </time>
        </span>
      </div>
      <header className="scratchpad-editor-toolbar">
        <div
          aria-label="Scratchpad editing mode"
          className="scratchpad-mode-switch"
          role="group"
        >
          <button
            aria-label="Outline"
            aria-pressed={editorMode === "outline"}
            title="Outline"
            type="button"
            onClick={() => void changeEditorMode("outline")}
          >
            <ListTree aria-hidden="true" size={17} />
          </button>
          <button
            aria-label="Markdown"
            aria-pressed={editorMode === "markdown"}
            title="Markdown"
            type="button"
            onClick={() => void changeEditorMode("markdown")}
          >
            <FileCode2 aria-hidden="true" size={17} />
          </button>
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
          {editorMode === "outline" ? (
            <button
              aria-label="Create task notes"
              className="text-action scratchpad-review-action"
              disabled={!drafts}
              type="button"
              onClick={openReview}
            >
              <ListChecks aria-hidden="true" size={17} /> Create task notes
            </button>
          ) : null}
        </div>
      </header>
      {error ? (
        <div className="scratchpad-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void load()}>
            Reload
          </button>
        </div>
      ) : null}
      {editorMode === "markdown" ? (
        <Suspense fallback={<div className="scratchpad-loading" />}>
          <MarkdownSourceEditor
            ariaLabel="Scratchpad Markdown"
            autoFocus={isCurrent}
            value={source}
            onChange={setSource}
          />
        </Suspense>
      ) : (
        <div
          className="scratchpad-outline"
          role="tree"
          aria-label="Scratchpad outline"
        >
          {visibleNodes.map(({ node, descendantCount }) => {
            const linkedTask = node.taskId
              ? linkedTasks.get(node.taskId)
              : undefined;
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
                  {descendantCount ? (
                    <button
                      aria-expanded={!collapsedIds.has(node.id)}
                      aria-label={`${collapsedIds.has(node.id) ? "Expand" : "Collapse"} ${node.text || "item"}, ${descendantCount} nested ${descendantCount === 1 ? "item" : "items"}`}
                      className="scratchpad-collapse"
                      type="button"
                      onClick={() =>
                        setCollapsedIds((current) => {
                          const next = new Set(current);
                          if (next.has(node.id)) next.delete(node.id);
                          else next.add(node.id);
                          return next;
                        })
                      }
                    >
                      {collapsedIds.has(node.id) ? (
                        <ChevronRight aria-hidden="true" size={17} />
                      ) : (
                        <ChevronDown aria-hidden="true" size={17} />
                      )}
                    </button>
                  ) : (
                    <span className="scratchpad-collapse-spacer" />
                  )}
                  <button
                    aria-label={`Move ${node.text || "empty item"}`}
                    className="scratchpad-drag-handle"
                    type="button"
                    onPointerDown={(event) => beginDrag(event, node.id)}
                  >
                    <GripVertical aria-hidden="true" size={18} />
                  </button>
                  {node.kind === "task" ? (
                    <span className="scratchpad-kind-label is-linked">
                      <Link2 aria-hidden="true" size={14} />
                      <span>Linked</span>
                    </span>
                  ) : (
                    <div className="scratchpad-kind-controls">
                      {node.kind === "draft" ? (
                        <button
                          aria-label={`${node.completed ? "Mark incomplete" : "Mark complete"} ${node.text || "empty task"}`}
                          aria-pressed={Boolean(node.completed)}
                          className="scratchpad-draft-completion"
                          title={
                            node.completed ? "Completed draft" : "Task draft"
                          }
                          type="button"
                          onClick={() =>
                            changeNode(node.id, { completed: !node.completed })
                          }
                        >
                          {node.completed ? (
                            <SquareCheckBig aria-hidden="true" size={19} />
                          ) : (
                            <Square aria-hidden="true" size={19} />
                          )}
                        </button>
                      ) : (
                        <span
                          aria-hidden="true"
                          className="scratchpad-note-kind-icon"
                        >
                          <StickyNote size={19} />
                        </span>
                      )}
                      <button
                        aria-label={
                          node.kind === "draft"
                            ? `Convert ${node.text || "empty task"} to note`
                            : "Make a task"
                        }
                        className="scratchpad-kind-toggle"
                        title={
                          node.kind === "draft" ? "Convert to note" : "Note"
                        }
                        type="button"
                        onClick={() =>
                          changeNode(node.id, {
                            kind: node.kind === "draft" ? "note" : "draft",
                            completed: false,
                          })
                        }
                      >
                        {node.kind === "draft" ? "Task" : "Note"}
                      </button>
                    </div>
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
                      data-scratch-input={`${document?.id ?? initialDocument.id}:${node.id}`}
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
                          event.currentTarget.selectionStart ??
                            node.text.length,
                        );
                      }}
                      onClick={(event) =>
                        setCursor(
                          event.currentTarget.selectionStart ??
                            node.text.length,
                        )
                      }
                      onKeyDown={(event) => handleKeyDown(event, node)}
                      onSelect={(event) =>
                        setCursor(
                          event.currentTarget.selectionStart ??
                            node.text.length,
                        )
                      }
                    />
                  )}
                  {node.kind === "draft" && node.text.trim() ? (
                    <button
                      aria-label={`Create task for ${node.text}`}
                      className="scratchpad-convert-line"
                      disabled={Boolean(convertingId) || reviewProcessing}
                      title="Create task"
                      type="button"
                      onClick={() => void convertNode(node.id)}
                    >
                      <FileCheck2 aria-hidden="true" size={18} />
                    </button>
                  ) : null}
                  {node.kind === "task" && linkedTask ? (
                    <TaskActions
                      task={linkedTask}
                      onOpen={(task) => onOpenTask(task)}
                      onToggle={async (task) => {
                        const updated = await updateTask(task.id, {
                          completed: !task.completed,
                        });
                        setLinkedTasks((current) =>
                          new Map(current).set(updated.id, updated),
                        );
                      }}
                      onDeleted={() =>
                        updateNodes(
                          removeScratchNode(nodesRef.current, node.id),
                        )
                      }
                    />
                  ) : (
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
                  )}
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
                {activeId === node.id && node.kind !== "task" ? (
                  <div
                    aria-label={`Outline controls for ${node.text || "empty item"}`}
                    className="scratchpad-mobile-depth-actions"
                  >
                    <button
                      disabled={node.depth === 0}
                      type="button"
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={() => changeDepth(node, -1)}
                    >
                      <CornerUpLeft aria-hidden="true" size={15} /> Outdent
                    </button>
                    <button
                      disabled={!canIndent(node)}
                      type="button"
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={() => changeDepth(node, 1)}
                    >
                      <CornerDownRight aria-hidden="true" size={15} /> Indent
                    </button>
                    <button
                      type="button"
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={() => addChild(node)}
                    >
                      <Plus aria-hidden="true" size={15} /> Child
                    </button>
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
                          index === selectedSuggestion
                            ? "is-selected"
                            : undefined
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
                    ref={rowMenuRef}
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
                        <FileCheck2 aria-hidden="true" size={17} /> Create task
                      </button>
                    ) : null}
                    {node.kind !== "task" ? (
                      <button
                        role="menuitem"
                        type="button"
                        onClick={() => {
                          changeNode(node.id, {
                            kind: node.kind === "draft" ? "note" : "draft",
                            completed: false,
                          });
                          setMenuId(undefined);
                        }}
                      >
                        {node.kind === "draft" ? (
                          <StickyNote aria-hidden="true" size={17} />
                        ) : (
                          <ListTodo aria-hidden="true" size={17} />
                        )}
                        {node.kind === "draft" ? "Keep as note" : "Make a task"}
                      </button>
                    ) : null}
                    <button
                      disabled={node.depth === 0}
                      role="menuitem"
                      type="button"
                      onClick={() => {
                        changeDepth(node, -1);
                        setMenuId(undefined);
                      }}
                    >
                      <CornerUpLeft aria-hidden="true" size={17} /> Outdent
                    </button>
                    <button
                      disabled={!canIndent(node)}
                      role="menuitem"
                      type="button"
                      onClick={() => {
                        changeDepth(node, 1);
                        setMenuId(undefined);
                      }}
                    >
                      <CornerDownRight aria-hidden="true" size={17} /> Indent
                    </button>
                    <button
                      role="menuitem"
                      type="button"
                      onClick={() => {
                        addChild(node);
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
                        updateNodes(
                          removeScratchNode(nodesRef.current, node.id),
                        );
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
      )}
      {reviewOpen ? (
        <div
          className="scratchpad-dialog-backdrop"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget && !reviewProcessing)
              setReviewOpen(false);
          }}
        >
          <section
            aria-labelledby="review-scratchpad-title"
            aria-modal="true"
            className="scratchpad-dialog scratchpad-review-dialog"
            role="dialog"
          >
            <header>
              <div>
                <p className="eyebrow">Choose what becomes a task</p>
                <h2 id="review-scratchpad-title">Create task notes</h2>
              </div>
              <button
                aria-label="Close"
                disabled={reviewProcessing}
                type="button"
                onClick={() => setReviewOpen(false)}
              >
                <X aria-hidden="true" size={20} />
              </button>
            </header>
            <p>
              Selected drafts become linked TaskNotes in place. Everything else
              stays in this scratchpad so you can keep working.
            </p>
            <div className="scratchpad-review-toolbar">
              <span>
                {selectedReviewCount} of {reviewItems.length} selected
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
                  ? "Clear selection"
                  : "Select all"}
              </button>
            </div>
            <div
              aria-label="Task drafts"
              className="scratchpad-review-list"
              role="list"
            >
              {reviewItems.map((item) => {
                const result = reviewResults[item.id];
                const sourceIndex = nodesRef.current.findIndex(
                  (node) => node.id === item.id,
                );
                const branchEnd =
                  sourceIndex < 0
                    ? sourceIndex
                    : scratchSubtreeEnd(nodesRef.current, sourceIndex);
                const hasDraftDescendants =
                  sourceIndex >= 0 &&
                  nodesRef.current
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
                        Select branch
                      </button>
                    ) : null}
                    {result?.state === "creating" ? (
                      <span className="scratchpad-review-status">
                        Creating…
                      </span>
                    ) : null}
                    {result?.state === "created" ? (
                      <span className="scratchpad-review-status is-success">
                        <Check aria-hidden="true" size={14} /> Created
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
                Keep writing
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
                  ? "Creating…"
                  : failedReviewCount
                    ? `Retry ${selectedReviewCount} task notes`
                    : `Create ${selectedReviewCount} task notes`}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {notice ? (
        <div className="scratchpad-notice" role="status">
          <span>{notice.message}</span>
          {notice.tasks?.length ? (
            <button
              className="scratchpad-notice-action"
              type="button"
              onClick={() => {
                onOpenTask(notice.tasks![0]!);
                setNotice(null);
              }}
            >
              {notice.tasks.length === 1 ? "Open task" : "Open first"}
            </button>
          ) : null}
          <button
            aria-label="Dismiss"
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

async function transitionToNewScratchpad(
  repository: TaskRepository,
  input: StartNewScratchpadInput,
): Promise<StartNewScratchpadResult> {
  if (repository.startNewScratchpad)
    return repository.startNewScratchpad(input);
  if (repository.archiveScratchpad) {
    const result = await repository.archiveScratchpad(input);
    return { previous: result.archived, current: result.active };
  }
  throw new Error("Scratchpad storage is not available for this collection.");
}

function isOutlineCompatible(body: string): boolean {
  if (!body.trim()) return true;
  const normalized = body.replaceAll("\r\n", "\n");
  return (
    scratchBody(parseScratchBody(normalized)).trimEnd() === normalized.trimEnd()
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

function readScratchpadCollapseState(key: string): {
  expandedDocuments: string[];
  collapsedImages: string[];
} {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null") as unknown;
    if (!value || typeof value !== "object")
      return { expandedDocuments: [], collapsedImages: [] };
    const state = value as Record<string, unknown>;
    return {
      expandedDocuments: Array.isArray(state.expandedDocuments)
        ? state.expandedDocuments.filter(
            (id): id is string => typeof id === "string",
          )
        : [],
      collapsedImages: Array.isArray(state.collapsedImages)
        ? state.collapsedImages.filter(
            (id): id is string => typeof id === "string",
          )
        : [],
    };
  } catch {
    return { expandedDocuments: [], collapsedImages: [] };
  }
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
