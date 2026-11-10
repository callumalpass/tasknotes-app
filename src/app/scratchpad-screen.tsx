import { t as translate } from "@lingui/core/macro";
import { t, plural } from "@lingui/core/macro";
import { useLingui, Trans } from "@lingui/react/macro";
import {
  Camera,
  ChevronDown,
  ChevronRight,
  FileImage,
  History,
  ImagePlus,
  MoreHorizontal,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
} from "react";

import { ScratchImageService } from "../application/scratch-images/scratch-image-service";
import { RecordWriteNotice } from "../components/record-write-notice";
import { scratchFeedKey } from "../domain/scratch-feed";
import {
  scratchpadHistoryDate,
  scratchpadPreview,
  type ReactivateScratchpadResult,
  type ScratchpadDocument,
  type StartNewScratchpadInput,
  type StartNewScratchpadResult,
} from "../domain/scratchpad";
import { uiCopy } from "../i18n/ui-copy";
import { useRepository } from "./repository-context";
import { formatScratchDate, message } from "./scratchpad-format";
import { ScratchNoteActions, ScratchpadNote } from "./scratchpad-note";
import { useMenuDirection, useScratchpadMenu } from "./use-scratchpad-menu";

import type { TaskRepository } from "../application/ports/task-repository";
import type { ScratchFeedItem } from "../domain/scratch-feed";
import type { ScratchImage } from "../domain/scratch-image";
import type { TaskSummary } from "../domain/task";

/** Matches the recovery window of deleted tasks. */
const SCRATCHPAD_DELETE_UNDO_MS = 30_000;
/** Clear space kept above the current note when the feed is at rest. */
const CURRENT_NOTE_TOP_GAP = 8;

export function ScratchpadScreen({
  onOpenTask,
}: {
  onOpenTask(task: TaskSummary): void;
}) {
  const { t } = useLingui();
  const { repository } = useRepository();
  const [currentDocument, setCurrentDocument] = useState<ScratchpadDocument>();
  const [historyItems, setHistoryItems] = useState<ScratchFeedItem[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [expandedImageIds, setExpandedImageIds] = useState<Set<string>>(
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
  const [reactivatingId, setReactivatingId] = useState<string>();
  const [imageCaptureOpen, setImageCaptureOpen] = useState(false);
  const [addingImages, setAddingImages] = useState(false);
  const [draggingImages, setDraggingImages] = useState(false);
  const [error, setError] = useState("");
  const [streamNotice, setStreamNotice] = useState("");
  const [resumeUndo, setResumeUndo] = useState<ScratchpadDocument>();
  const [pendingDeletion, setPendingDeletion] = useState<ScratchpadDocument>();
  const pendingDeletionRef = useRef<
    { document: ScratchpadDocument; timer: number } | undefined
  >(undefined);
  const deletionUndoRef = useRef<HTMLButtonElement | null>(null);
  const flushers = useRef(new Map<string, () => Promise<unknown>>());
  const imageActionRef = useRef<HTMLButtonElement | null>(null);
  const imageCaptureRef = useRef<HTMLElement | null>(null);
  const screenRef = useRef<HTMLElement | null>(null);
  const historyRef = useRef<HTMLDivElement | null>(null);
  const currentCardRef = useRef<HTMLElement | null>(null);
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
        if (!current)
          throw new Error(
            t({ message: "The current scratchpad is unavailable." }),
          );
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
      setError(t`Previous notes could not be loaded. ${message(reason)}`);
    } finally {
      setLoadingHistory(false);
    }
  }, [repository, t]);

  const loadStream = useCallback(async () => {
    if (
      !repository.getActiveScratchpad &&
      !repository.listScratchFeed &&
      !repository.listScratchpads
    ) {
      setError(
        t({
          message: "Scratchpad storage is not available for this collection.",
        }),
      );
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
        if (!current)
          throw new Error(
            t({ message: "The current scratchpad is unavailable." }),
          );
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
  }, [loadHistory, repository, t]);

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
        setExpandedImageIds(new Set(stored.expandedImages));
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
          expandedImages: [...expandedImageIds],
        }),
      );
    } catch {
      // Collapse preferences are optional local UI state.
    }
  }, [collapseStateLoaded, collapseStorageKey, expandedIds, expandedImageIds]);

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
      // The line that was pressed stays where it is; what follows moves down.
      stickToBottom.current = false;
      setExpandedIds((current) => new Set(current).add(document.id));
    }
  }

  async function startNew() {
    const current = currentDocument;
    if (
      !current ||
      startingNew ||
      reactivatingId !== undefined ||
      (!repository.startNewScratchpad && !repository.archiveScratchpad)
    )
      return;
    setStartingNew(true);
    setResumeUndo(undefined);
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

  // The delete is sent only when its undo window closes. A note's type assigns
  // a new id and creation date on create, so a deleted note cannot be restored
  // as itself; until then the card is only hidden.
  const commitDeletion = useCallback(async () => {
    const pending = pendingDeletionRef.current;
    if (!pending || !repository.deleteScratchpad) return;
    pendingDeletionRef.current = undefined;
    window.clearTimeout(pending.timer);
    const { document } = pending;
    try {
      await repository.deleteScratchpad({
        id: document.id,
        path: document.path,
        revision: document.revision,
      });
      setHistoryItems((items) =>
        items.filter(
          (item) => item.kind === "image" || item.id !== document.id,
        ),
      );
      setExpandedIds((current) => {
        if (!current.has(document.id)) return current;
        const next = new Set(current);
        next.delete(document.id);
        return next;
      });
    } catch (reason) {
      // Use the current singleton without changing this lifecycle callback on
      // locale switches: its effect cleanup accepts the pending deletion.
      setError(translate`The note was not deleted. ${message(reason)}`);
    } finally {
      setPendingDeletion((current) =>
        current?.id === document.id ? undefined : current,
      );
    }
  }, [repository]);

  useEffect(() => {
    // Leaving the screen or the page accepts a pending deletion.
    const commit = () => void commitDeletion();
    window.addEventListener("pagehide", commit);
    return () => {
      window.removeEventListener("pagehide", commit);
      commit();
    };
  }, [commitDeletion]);

  useEffect(() => {
    // The deleted card took focus with it; Undo is the nearest useful target.
    if (pendingDeletion) deletionUndoRef.current?.focus();
  }, [pendingDeletion]);

  async function requestDeletion(document: ScratchpadDocument) {
    if (
      !repository.deleteScratchpad ||
      startingNew ||
      reactivatingId !== undefined
    )
      return;
    setError("");
    let latest: ScratchpadDocument;
    try {
      // Only one undo window is open at a time.
      await commitDeletion();
      const flushed = (await flushers.current.get(document.id)?.()) as
        ScratchpadDocument | undefined;
      latest = flushed ?? document;
    } catch (reason) {
      setError(message(reason));
      return;
    }
    setResumeUndo(undefined);
    setStreamNotice("");
    pendingDeletionRef.current = {
      document: latest,
      timer: window.setTimeout(
        () => void commitDeletion(),
        SCRATCHPAD_DELETE_UNDO_MS,
      ),
    };
    setPendingDeletion(latest);
  }

  function undoDeletion() {
    const pending = pendingDeletionRef.current;
    // Without a pending entry the delete has already been sent.
    if (!pending) return;
    window.clearTimeout(pending.timer);
    pendingDeletionRef.current = undefined;
    setPendingDeletion(undefined);
  }

  const historicalItems = [...historyItems]
    .reverse()
    .filter((item) => item.kind === "image" || item.id !== pendingDeletion?.id);

  useLayoutEffect(() => {
    const surface = screenRef.current;
    const viewport = window.visualViewport;
    if (!surface || !viewport) return;

    let frame = 0;
    const update = () => {
      const visualBottom = Math.max(0, viewport.offsetTop + viewport.height);
      surface.style.setProperty(
        "--scratch-visual-viewport-bottom",
        `${visualBottom}px`,
      );
      const scroller = historyRef.current;
      if (scroller && stickToBottom.current)
        scroller.scrollTop = scroller.scrollHeight;
    };
    const scheduleUpdate = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(update);
    };
    update();
    viewport.addEventListener("resize", scheduleUpdate);
    viewport.addEventListener("scroll", scheduleUpdate);
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      window.cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", scheduleUpdate);
      viewport.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      surface.style.removeProperty("--scratch-visual-viewport-bottom");
    };
  }, [loading]);

  useLayoutEffect(() => {
    const scroller = historyRef.current;
    const card = currentCardRef.current;
    if (!scroller || !card) return;

    const updateRestSpace = () => {
      const bottomGutter = Number.parseFloat(
        getComputedStyle(scroller).paddingBottom,
      );
      // At rest the current note starts at the top of the feed, under the
      // heading that stays there; earlier notes sit above it, a scroll away.
      const heading = scroller.querySelector<HTMLElement>(
        ".scratchpad-stream-header",
      );
      const restSpace = Math.max(
        0,
        scroller.clientHeight -
          (heading?.offsetHeight ?? 0) -
          card.getBoundingClientRect().height -
          bottomGutter -
          CURRENT_NOTE_TOP_GAP,
      );
      const next = `${restSpace}px`;
      if (scroller.style.getPropertyValue("--scratch-current-rest") !== next)
        scroller.style.setProperty("--scratch-current-rest", next);
    };

    let frame = 0;
    const scheduleUpdate = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updateRestSpace);
    };
    updateRestSpace();
    window.addEventListener("resize", scheduleUpdate);
    const observer = new MutationObserver(scheduleUpdate);
    observer.observe(card, { childList: true, subtree: true });
    // The keyboard and the note's own growth change the room without a
    // window resize.
    const sizes =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(scheduleUpdate);
    sizes?.observe(scroller);
    sizes?.observe(card);
    void document.fonts?.ready.then(scheduleUpdate);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", scheduleUpdate);
      observer.disconnect();
      sizes?.disconnect();
    };
  }, [currentDocument]);

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
      setResumeUndo(undefined);
      setError("");
      setStreamNotice(
        plural(files.length, {
          1: "Adding image…",
          other: "Adding # images…",
        }),
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
          ? plural(created.length, {
              1: "Image added",
              other: "# images added",
            })
          : "",
      );
      if (failures.length) {
        setImageCaptureOpen(true);
        setError(
          `${message(failures[0])}${created.length ? ` ${plural(created.length, { one: "# image was added.", other: "# images were added." })}` : ""}`,
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
    const frame = requestAnimationFrame(() =>
      imageCaptureRef.current?.scrollIntoView?.({ block: "center" }),
    );
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setImageCaptureOpen(false);
      imageActionRef.current?.focus();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", closeOnEscape);
    };
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
          <Trans>Opening current note…</Trans>
        </span>
      </section>
    );

  async function reactivate(document: ScratchpadDocument, offerUndo = true) {
    const current = currentDocument;
    if (
      !current ||
      startingNew ||
      reactivatingId !== undefined ||
      !repository.reactivateScratchpad
    )
      return;
    setReactivatingId(document.id);
    setError("");
    try {
      const flushedTarget = (await flushers.current.get(document.id)?.()) as
        ScratchpadDocument | undefined;
      const flushedCurrent = (await flushers.current.get(current.id)?.()) as
        ScratchpadDocument | undefined;
      const target = flushedTarget ?? document;
      const latestCurrent = flushedCurrent ?? current;
      const result: ReactivateScratchpadResult =
        await repository.reactivateScratchpad({
          current: {
            id: latestCurrent.id,
            path: latestCurrent.path,
            revision: latestCurrent.revision,
          },
          target: {
            id: target.id,
            path: target.path,
            revision: target.revision,
          },
        });
      revealBottom.current = true;
      stickToBottom.current = true;
      setCurrentDocument(result.current);
      setHistoryItems((items) => [
        { kind: "scratchpad", ...result.previous },
        ...items.filter(
          (item) =>
            item.kind === "image" ||
            (item.id !== result.current.id && item.id !== result.previous.id),
        ),
      ]);
      setNextCursor(undefined);
      setResumeUndo(offerUndo ? result.previous : undefined);
      setStreamNotice(
        t`${result.current.title?.trim() || uiCopy("Previous note")} resumed`,
      );
      if (repository.listScratchFeed) {
        try {
          const page = await repository.listScratchFeed();
          setHistoryItems(page.items);
          setNextCursor(page.nextCursor);
        } catch (reason) {
          setError(
            t`The note was resumed, but history could not refresh. ${message(reason)}`,
          );
        }
      }
    } catch (reason) {
      setError(message(reason));
    } finally {
      setReactivatingId(undefined);
    }
  }

  const note = (document: ScratchpadDocument, isCurrent = false) => (
    <ScratchpadNote
      key={document.id}
      initialDocument={document}
      isCurrent={isCurrent}
      onOpenTask={onOpenTask}
      onReactivate={
        !isCurrent && repository.reactivateScratchpad
          ? () => void reactivate(document)
          : undefined
      }
      onCollapse={isCurrent ? undefined : () => void toggleDocument(document)}
      onDelete={
        !isCurrent && repository.deleteScratchpad
          ? () => void requestDeletion(document)
          : undefined
      }
      reactivating={reactivatingId === document.id}
      reactivationDisabled={startingNew || reactivatingId !== undefined}
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

  /** Brings the notes above the current one into view. */
  function showEarlier() {
    const scroller = historyRef.current;
    if (!scroller) return;
    stickToBottom.current = false;
    revealBottom.current = false;
    scroller.scrollBy({
      top: -Math.round(scroller.clientHeight * 0.6),
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }

  return (
    <section
      className="screen scratchpad-screen"
      aria-labelledby="scratchpad-stream-title"
      ref={screenRef}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {draggingImages ? (
        <div className="scratchpad-drop-overlay" role="status">
          <ImagePlus aria-hidden="true" size={30} />
          <strong>
            <Trans>Drop images to add them</Trans>
          </strong>
        </div>
      ) : null}
      {pendingDeletion ? (
        <div className="scratchpad-notice" role="status">
          <span className="scratchpad-notice-title">
            {pendingDeletion.title?.trim()
              ? translate`Deleted “${pendingDeletion.title.trim()}”`
              : translate({ message: "Note deleted" })}
            <span className="visually-hidden">
              <Trans>. Undo is available for 30 seconds.</Trans>
            </span>
          </span>
          <button
            className="scratchpad-notice-action"
            ref={deletionUndoRef}
            type="button"
            onClick={undoDeletion}
          >
            <Trans>Undo</Trans>
          </button>
          <button
            aria-label={translate({ message: "Dismiss" })}
            type="button"
            onClick={() => void commitDeletion()}
          >
            <X aria-hidden="true" size={16} />
          </button>
        </div>
      ) : streamNotice ? (
        <div className="scratchpad-notice" role="status">
          <span>{streamNotice}</span>
          {resumeUndo ? (
            <button
              className="scratchpad-notice-action"
              disabled={reactivatingId !== undefined}
              type="button"
              onClick={() => {
                const target = resumeUndo;
                setResumeUndo(undefined);
                setStreamNotice("");
                void reactivate(target, false);
              }}
            >
              <Trans>Undo</Trans>
            </button>
          ) : null}
          <button
            aria-label={t({ message: "Dismiss" })}
            type="button"
            onClick={() => {
              setResumeUndo(undefined);
              setStreamNotice("");
            }}
          >
            <X aria-hidden="true" size={16} />
          </button>
        </div>
      ) : null}
      {error ? (
        <div className="scratchpad-error" role="alert">
          {error}
          <button type="button" onClick={() => void loadStream()}>
            <Trans>Reload</Trans>
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
          <header className="scratchpad-stream-header">
            <h1 id="scratchpad-stream-title">
              <Trans>Scratchpad</Trans>
            </h1>
            <div className="scratchpad-stream-actions">
              {historicalItems.length ? (
                <button
                  aria-label={t({ message: "Earlier notes" })}
                  className="text-action scratchpad-earlier-action"
                  title={t({ message: "Earlier notes" })}
                  type="button"
                  onClick={showEarlier}
                >
                  <History aria-hidden="true" size={18} />
                  <span>
                    <Trans>Earlier notes</Trans>
                  </span>
                </button>
              ) : null}
              <button
                aria-label={t({ message: "Add image" })}
                aria-expanded={imageCaptureOpen}
                aria-controls="scratchpad-image-capture"
                className="text-action scratchpad-image-action"
                disabled={!repository.files || !repository.createScratchImage}
                ref={imageActionRef}
                title={t({ message: "Add image" })}
                type="button"
                onClick={() => {
                  if (!imageCaptureOpen) {
                    stickToBottom.current = false;
                    revealBottom.current = false;
                  }
                  setImageCaptureOpen((open) => !open);
                }}
              >
                <ImagePlus aria-hidden="true" size={18} />
                <span>
                  <Trans>Add image</Trans>
                </span>
              </button>
              <button
                aria-label={t({ message: "New note" })}
                className="text-action scratchpad-new-action"
                type="button"
                onClick={() => void startNew()}
                disabled={
                  startingNew ||
                  reactivatingId !== undefined ||
                  (!repository.startNewScratchpad &&
                    !repository.archiveScratchpad)
                }
              >
                <Plus aria-hidden="true" size={18} />
                <span>
                  {startingNew
                    ? t({ message: "Starting…" })
                    : t({ message: "New note" })}
                </span>
              </button>
            </div>
          </header>
          {nextCursor ? (
            <button
              className="text-action scratchpad-load-older"
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
              {loadingOlder
                ? t({ message: "Loading…" })
                : t({ message: "Load older" })}
            </button>
          ) : null}
          <div
            aria-busy={loadingHistory}
            aria-label={t({ message: "Scratchpad history" })}
            className={`scratchpad-history${historyLoaded ? " is-loaded" : ""}`}
          >
            {loadingHistory ? (
              <span className="visually-hidden" role="status">
                <Trans>Loading previous notes…</Trans>
              </span>
            ) : null}
            {historicalItems.map((item) => {
              if (item.kind === "image")
                return (
                  <ScratchImageRow
                    expanded={expandedImageIds.has(item.id)}
                    image={item}
                    key={scratchFeedKey(item)}
                    repository={repository}
                    onExpandedChange={(expanded) => {
                      if (expanded) stickToBottom.current = false;
                      setExpandedImageIds((current) => {
                        const next = new Set(current);
                        if (expanded) next.add(item.id);
                        else next.delete(item.id);
                        return next;
                      });
                    }}
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
                  {expanded ? (
                    // An opened note is its own line: the title or date, then
                    // what can be done with it.
                    note(document)
                  ) : (
                    <>
                      <div className="scratchpad-document-header">
                        <button
                          className={`scratchpad-document-disclosure${document.title ? " has-title" : ""}`}
                          type="button"
                          aria-expanded="false"
                          onClick={() => void toggleDocument(document)}
                        >
                          <span>
                            {document.title ? (
                              <strong>{document.title}</strong>
                            ) : null}
                            <time dateTime={scratchpadHistoryDate(document)}>
                              {formatScratchDate(
                                scratchpadHistoryDate(document),
                              )}
                            </time>
                          </span>
                          {document.title ? (
                            <small>{scratchpadPreview(document)}</small>
                          ) : null}
                          <ChevronRight
                            aria-hidden="true"
                            className="scratchpad-document-chevron"
                            size={18}
                          />
                        </button>
                        {repository.deleteScratchpad ? (
                          <ScratchNoteActions
                            disabled={
                              startingNew || reactivatingId !== undefined
                            }
                            onDelete={() => void requestDeletion(document)}
                          />
                        ) : null}
                      </div>
                      <RecordWriteNotice
                        repository={repository}
                        target={{ kind: "scratchpad", id: document.id }}
                      />
                    </>
                  )}
                </article>
              );
            })}
          </div>
          {currentDocument ? (
            <div aria-hidden="true" className="scratchpad-current-spacer" />
          ) : null}
          {imageCaptureOpen ? (
            <section
              aria-labelledby="scratchpad-image-capture-title"
              className="scratchpad-image-capture"
              id="scratchpad-image-capture"
              ref={imageCaptureRef}
            >
              <header>
                <div>
                  <strong id="scratchpad-image-capture-title">
                    <Trans>Add image</Trans>
                  </strong>
                  <p>
                    <Trans>
                      Drop images here, paste them, upload files, or take a
                      photo.
                    </Trans>
                  </p>
                </div>
                <button
                  aria-label={t({ message: "Close image capture" })}
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
                  {addingImages
                    ? t({ message: "Adding…" })
                    : t({ message: "Upload images" })}
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
                  <Camera aria-hidden="true" size={18} />{" "}
                  <Trans>Take photo</Trans>
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
            <>
              <article
                className="scratchpad-current-document"
                ref={currentCardRef}
              >
                {note(currentDocument, true)}
              </article>
              <div
                aria-hidden="true"
                className="scratchpad-current-rest-space"
              />
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/** An image in the feed: a dated line with a thumbnail that opens in place. */
function ScratchImageRow({
  expanded,
  image,
  repository,
  onExpandedChange,
  onRemoved,
}: {
  expanded: boolean;
  image: ScratchImage;
  repository: TaskRepository;
  onExpandedChange(expanded: boolean): void;
  onRemoved(): void;
}) {
  const { t } = useLingui();
  const [source, setSource] = useState<string>();
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">(
    repository.files ? "loading" : "missing",
  );
  const [removing, setRemoving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);

  useScratchpadMenu(menuOpen, menuRef, menuTriggerRef, () =>
    setMenuOpen(false),
  );
  useMenuDirection(menuOpen, menuRef, menuTriggerRef);

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
        t({
          message:
            "Remove this image card from Scratchpad? The image file will be kept.",
        }),
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

  const unavailable = state === "missing" || state === "error";
  const alt = image.caption || t`Pasted Scratchpad image`;

  return (
    <article
      className={`scratch-image-row${expanded ? " is-expanded" : ""}`}
      data-feed-key={scratchFeedKey(image)}
    >
      <div className="scratch-image-line">
        <button
          aria-expanded={expanded}
          aria-label={
            expanded
              ? t({ message: "Collapse image" })
              : t({ message: "Expand image" })
          }
          className="scratch-image-disclosure"
          type="button"
          onClick={() => onExpandedChange(!expanded)}
        >
          <span className="scratch-image-thumb">
            {state === "ready" && source ? (
              <img alt="" src={source} />
            ) : (
              <FileImage aria-hidden="true" size={17} />
            )}
          </span>
          <span className="scratch-image-label">
            {image.caption ? <strong>{image.caption}</strong> : null}
            <time dateTime={image.dateCreated}>
              {formatScratchDate(image.dateCreated, true)}
            </time>
          </span>
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
        <div className="scratch-image-actions">
          <button
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-label={t({ message: "Image actions" })}
            className="scratchpad-document-menu-trigger"
            disabled={removing}
            ref={menuTriggerRef}
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <MoreHorizontal aria-hidden="true" size={18} />
          </button>
          {menuOpen ? (
            <div
              aria-label={t({ message: "Image actions" })}
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
              <button
                aria-label={t({ message: "Remove image card" })}
                className="danger"
                disabled={removing || !repository.removeScratchImage}
                role="menuitem"
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  void remove();
                }}
              >
                <Trash2 aria-hidden="true" size={17} />{" "}
                <Trans>Remove from Scratchpad</Trans>
              </button>
            </div>
          ) : null}
        </div>
      </div>
      <RecordWriteNotice
        repository={repository}
        target={{ kind: "image", id: image.id }}
      />
      {expanded ? (
        <div
          className={`scratch-image-frame${unavailable ? " is-unavailable" : ""}`}
          style={
            !unavailable && image.width && image.height
              ? { aspectRatio: `${image.width} / ${image.height}` }
              : undefined
          }
        >
          {state === "ready" && source ? (
            <img alt={alt} src={source} />
          ) : (
            <div
              className="scratch-image-placeholder"
              role={state === "error" ? "alert" : "status"}
            >
              <FileImage aria-hidden="true" size={24} />
              {state === "loading"
                ? t({ message: "Loading image…" })
                : state === "missing"
                  ? t({ message: "Image file is unavailable" })
                  : t({ message: "Image could not be loaded" })}
            </div>
          )}
        </div>
      ) : null}
    </article>
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
  throw new Error(
    t({ message: "Scratchpad storage is not available for this collection." }),
  );
}

function readScratchpadCollapseState(key: string): {
  expandedDocuments: string[];
  expandedImages: string[];
} {
  const ids = (value: unknown) =>
    Array.isArray(value)
      ? value.filter((id): id is string => typeof id === "string")
      : [];
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null") as unknown;
    if (!value || typeof value !== "object")
      return { expandedDocuments: [], expandedImages: [] };
    const state = value as Record<string, unknown>;
    return {
      expandedDocuments: ids(state.expandedDocuments),
      expandedImages: ids(state.expandedImages),
    };
  } catch {
    return { expandedDocuments: [], expandedImages: [] };
  }
}
