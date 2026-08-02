import {
  ExternalLink,
  FileImage,
  ImagePlus,
  LoaderCircle,
  Trash2,
  Unlink,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import {
  AttachmentService,
  type ResolvedTaskAttachment,
} from "../application/attachments/attachment-service";

import type { Task } from "../domain/task";
import type { CollectionFileStore } from "../application/ports/collection-file-store";

export function TaskAttachments({
  task,
  service,
  store,
  beforeMutation,
  onInsertInline,
}: {
  task: Task;
  service: AttachmentService;
  store: CollectionFileStore;
  beforeMutation(): Promise<void>;
  onInsertInline(reference: string): Promise<void>;
}) {
  const attachInputId = useId();
  const insertInputId = useId();
  const [items, setItems] = useState<ResolvedTaskAttachment[]>([]);
  const [loading, setLoading] = useState(service.available());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [physicalDeletionAvailable, setPhysicalDeletionAvailable] = useState<
    boolean | null
  >(null);
  const mounted = useRef(true);
  const loadGeneration = useRef(0);
  const keepButtonRef = useRef<HTMLButtonElement>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    if (!service.available()) return;
    const generation = ++loadGeneration.current;
    setLoading(true);
    try {
      await service.recover();
      const [resolved, canDelete] = await Promise.all([
        service.resolve((await service.currentTask(task.id)) ?? task),
        service.physicalDeletionAvailable(),
      ]);
      if (mounted.current && generation === loadGeneration.current) {
        setItems(resolved);
        setPhysicalDeletionAvailable(canDelete);
        setError(null);
      }
    } catch (reason) {
      if (mounted.current && generation === loadGeneration.current)
        setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (mounted.current && generation === loadGeneration.current)
        setLoading(false);
    }
  }, [service, task]);

  useEffect(() => {
    mounted.current = true;
    queueMicrotask(() => {
      if (mounted.current) void load();
    });
    return () => {
      mounted.current = false;
      loadGeneration.current += 1;
    };
  }, [load]);

  useEffect(() => {
    if (confirming) keepButtonRef.current?.focus();
  }, [confirming]);

  async function run(action: () => Promise<unknown>): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await beforeMutation();
      await action();
      await load();
    } catch (reason) {
      if (mounted.current)
        setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  function selectImage(file: File | undefined, inline: boolean): void {
    if (!file) return;
    void run(async () => {
      const result = await service.attachImage(task.id, file);
      if (inline) await onInsertInline(result.reference);
    });
  }

  function openImage(item: ResolvedTaskAttachment): void {
    if (!item.file || busy) return;
    const target = window.open("about:blank", "_blank");
    if (!target) {
      setError(
        "Your browser blocked the image window. Allow pop-ups and try again.",
      );
      return;
    }
    try {
      target.opener = null;
    } catch {
      // Some WebViews expose a read-only opener; the blank target is still safe.
    }
    setBusy(true);
    setError(null);
    void openAttachment(store, item.file, target)
      .catch((reason) => {
        target.close();
        if (mounted.current)
          setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (mounted.current) setBusy(false);
      });
  }

  if (!service.available()) return null;

  return (
    <section
      className="task-attachments"
      aria-labelledby="task-attachments-title"
    >
      <header className="task-attachments-heading">
        <div>
          <h2 id="task-attachments-title">Attachments</h2>
          <p>Listed with this task. Inserting an image in Notes is optional.</p>
        </div>
        <div className="task-attachment-add-actions">
          <input
            accept="image/avif,image/gif,image/heic,image/heif,image/jpeg,image/png,image/webp"
            disabled={busy}
            id={attachInputId}
            type="file"
            onChange={(event) => {
              selectImage(event.target.files?.[0], false);
              event.currentTarget.value = "";
            }}
          />
          <label className="text-action" htmlFor={attachInputId}>
            <ImagePlus aria-hidden="true" size={17} /> Attach image
          </label>
          <input
            accept="image/avif,image/gif,image/heic,image/heif,image/jpeg,image/png,image/webp"
            disabled={busy}
            id={insertInputId}
            type="file"
            onChange={(event) => {
              selectImage(event.target.files?.[0], true);
              event.currentTarget.value = "";
            }}
          />
          <label className="text-action" htmlFor={insertInputId}>
            Insert in Notes
          </label>
        </div>
      </header>

      {error ? (
        <p className="attachment-error" role="alert">
          {error}
        </p>
      ) : null}
      {physicalDeletionAvailable === false ? (
        <p className="attachment-policy">
          Synced images can be detached from this task. Permanent file deletion
          waits for an authoritative mdbase reference check.
        </p>
      ) : null}
      {loading && !items.length ? (
        <p className="attachment-status" role="status">
          <LoaderCircle aria-hidden="true" className="spin" size={17} /> Loading
          images…
        </p>
      ) : items.length ? (
        <ul className="attachment-list">
          {items.map((item) => (
            <li key={item.reference}>
              <AttachmentThumbnail item={item} store={store} />
              <div className="attachment-identity">
                <strong>{displayName(item.path ?? item.reference)}</strong>
                <small>{attachmentState(item)}</small>
              </div>
              {confirming === item.reference ? (
                <div
                  className="attachment-delete-confirm"
                  role="group"
                  aria-label="Confirm file deletion"
                >
                  <span>
                    Delete this image from the collection? It will also be
                    detached from this task. This can&apos;t be undone.
                  </span>
                  <button
                    ref={keepButtonRef}
                    type="button"
                    onClick={() => {
                      setConfirming(null);
                      queueMicrotask(() => deleteTriggerRef.current?.focus());
                    }}
                  >
                    Keep
                  </button>
                  <button
                    className="danger"
                    disabled={busy}
                    type="button"
                    onClick={() =>
                      void run(() =>
                        service.deletePhysical(task.id, item.reference),
                      )
                    }
                  >
                    Delete
                  </button>
                </div>
              ) : (
                <div className="attachment-actions">
                  {item.file ? (
                    <button
                      aria-label={`Open ${displayName(item.path ?? item.reference)}`}
                      disabled={busy}
                      title="Open image"
                      type="button"
                      onClick={() => openImage(item)}
                    >
                      <ExternalLink aria-hidden="true" size={17} />
                    </button>
                  ) : null}
                  <button
                    disabled={busy || !item.file}
                    type="button"
                    onClick={() =>
                      void run(async () => {
                        await service.assertInlineInsertable(
                          task.id,
                          item.reference,
                        );
                        await onInsertInline(item.reference);
                      })
                    }
                  >
                    Insert
                  </button>
                  <button
                    aria-label={`Detach ${displayName(item.path ?? item.reference)}`}
                    disabled={busy}
                    title="Detach from task"
                    type="button"
                    onClick={() =>
                      void run(() => service.detach(task.id, item.reference))
                    }
                  >
                    <Unlink aria-hidden="true" size={17} />
                    <span>Detach</span>
                  </button>
                  {physicalDeletionAvailable ? (
                    <button
                      aria-label={`Delete ${displayName(item.path ?? item.reference)} file`}
                      className="danger"
                      disabled={busy || !item.file}
                      title="Delete file"
                      type="button"
                      onClick={(event) => {
                        deleteTriggerRef.current = event.currentTarget;
                        setConfirming(item.reference);
                      }}
                    >
                      <Trash2 aria-hidden="true" size={17} />
                      <span>Delete</span>
                    </button>
                  ) : null}
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="attachment-empty">No images attached.</p>
      )}
    </section>
  );
}

function AttachmentThumbnail({
  item,
  store,
}: {
  item: ResolvedTaskAttachment;
  store?: CollectionFileStore;
}) {
  const [source, setSource] = useState<string | null>(null);
  useEffect(() => {
    if (!store || !item.file) return;
    let active = true;
    let url = "";
    void store
      .download(item.file)
      .then((blob) => {
        if (!active) return;
        url = URL.createObjectURL(blob);
        setSource(url);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [item.file, store]);
  return source ? (
    <img
      alt=""
      className="attachment-thumbnail"
      src={source}
      onError={() => setSource(null)}
    />
  ) : (
    <span className="attachment-thumbnail is-placeholder" aria-hidden="true">
      <FileImage size={20} />
    </span>
  );
}

function displayName(path: string): string {
  return path.replace(/^.*\//, "").replace(/^[0-9a-f-]{36}-/, "");
}

function attachmentState(item: ResolvedTaskAttachment): string {
  if (!item.file) return "File missing";
  if (item.file.pending === "upload")
    return "Saved locally · Waiting to upload";
  if (item.file.availability === "local") return "Saved on this device";
  return formatBytes(item.file.size);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function openAttachment(
  store: CollectionFileStore,
  file: NonNullable<ResolvedTaskAttachment["file"]>,
  target: Window,
): Promise<void> {
  const url = URL.createObjectURL(await store.download(file));
  target.location.href = url;
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
