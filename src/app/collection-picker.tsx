import type { CollectionAvailability } from "@mdbase-dev/sdk";
import { describeError } from "@mdbase-dev/sdk/describe";
import {
  ArrowRight,
  Check,
  Cloud,
  Folder,
  Monitor,
  Plus,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useOverlay } from "../components/overlays/use-overlay";

/** Approved presentation metadata from the SDK owner. Unknown authority stays
 * unknown; the picker neither infers a provider nor owns selection or URLs. */
export interface CollectionChoice {
  collectionId: string;
  displayName: string;
  authority?: { kind: "hosted" | "connector" };
  availability?: CollectionAvailability;
}
export function CollectionPicker({
  connections,
  selectedCollectionId,
  openingCollectionId = null,
  busy = false,
  error = null,
  onRetry,
  onAuthorize,
  onClose,
  onSelect,
}: {
  connections: readonly CollectionChoice[];
  /** The usable collection, never merely the requested target. */
  selectedCollectionId: string | null;
  openingCollectionId?: string | null;
  busy?: boolean;
  error?: string | null;
  onRetry?(): void;
  onAuthorize(): void;
  onClose(): void;
  onSelect?(collectionId: string): void;
}) {
  const [search, setSearch] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);
  const firstCollectionRef = useRef<HTMLButtonElement>(null);
  const selectedCollectionRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const working = busy || openingCollectionId !== null;
  // Dismissal is presentation only, not chooseAnother/clear/close. Once the
  // caller starts an action, wait for its result rather than imply a rollback.
  const dismiss = () => {
    if (!working) onClose();
  };
  const query = search.trim().toLocaleLowerCase();
  const visible = connections.filter((connection) =>
    connection.displayName.toLocaleLowerCase().includes(query),
  );
  const firstFocusableId = visible.find(
    (connection) =>
      connection.availability?.state !== "unavailable" &&
      connection.availability?.state !== "opening" &&
      (connection.collectionId === selectedCollectionId || onSelect),
  )?.collectionId;
  const openingName = connections.find(
    (connection) => connection.collectionId === openingCollectionId,
  )?.displayName;
  useOverlay({
    open: true,
    rootRef: dialogRef,
    modal: true,
    onDismiss: dismiss,
    initialFocus: () =>
      working
        ? dialogRef.current
        : (selectedCollectionRef.current ??
          firstCollectionRef.current ??
          closeRef.current),
  });

  return createPortal(
    <div className="collection-picker-scrim">
      <section
        aria-labelledby="collection-picker-title"
        aria-modal="true"
        className="collection-picker"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="collection-picker-header">
          <div>
            <p className="eyebrow">TaskNotes collection</p>
            <h2 id="collection-picker-title">Choose where to work</h2>
            <p>Choose a collection without leaving your current page.</p>
          </div>
          <button
            aria-label="Close collection picker"
            className="icon-action"
            disabled={working}
            onClick={dismiss}
            ref={closeRef}
            title="Close collections"
            type="button"
          >
            <X aria-hidden="true" size={20} />
          </button>
        </header>
        <div className="collection-picker-content">
          {connections.length >= 6 ? (
            <label className="collection-picker-search">
              <span>Search collections</span>
              <input
                disabled={working}
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          ) : null}
          {working ? (
            <p className="connection-status" role="status">
              {openingCollectionId
                ? openingName
                  ? `Opening ${openingName}…`
                  : "Opening collection…"
                : "Opening mdbase…"}
            </p>
          ) : null}
          {error ? (
            <div className="collection-picker-error">
              <p className="inline-error" role="alert">
                {error}
              </p>
              {onRetry ? (
                <button
                  className="text-action"
                  disabled={working}
                  onClick={onRetry}
                  type="button"
                >
                  Retry
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="collection-picker-group" aria-busy={working}>
            <h3>Collections</h3>
            <div>
              {visible.map((connection) => {
                const active = connection.collectionId === selectedCollectionId;
                const authority = connection.authority?.kind;
                const unavailable =
                  connection.availability?.state === "unavailable";
                const opening = connection.availability?.state === "opening";
                const description = unavailable
                  ? describeError(connection)
                  : null;
                const disabled =
                  working || unavailable || opening || (!active && !onSelect);
                return (
                  <button
                    aria-current={active ? "true" : undefined}
                    className={`collection-picker-row${active ? " current" : ""}${unavailable ? " unavailable" : ""}`}
                    disabled={disabled}
                    key={connection.collectionId}
                    onClick={() => {
                      if (disabled) return;
                      if (active) onClose();
                      else onSelect?.(connection.collectionId);
                    }}
                    ref={(element) => {
                      if (connection.collectionId === firstFocusableId)
                        firstCollectionRef.current = disabled ? null : element;
                      if (active)
                        selectedCollectionRef.current = disabled
                          ? null
                          : element;
                    }}
                    type="button"
                  >
                    <span className="collection-picker-row-icon">
                      {authority === "hosted" ? (
                        <Cloud aria-hidden="true" size={19} />
                      ) : authority === "connector" ? (
                        <Monitor aria-hidden="true" size={19} />
                      ) : (
                        <Folder aria-hidden="true" size={19} />
                      )}
                    </span>
                    <span>
                      <strong>{connection.displayName}</strong>
                      {authority ? (
                        <small>
                          {authority === "hosted"
                            ? "Hosted by mdbase"
                            : "Connected computer"}
                        </small>
                      ) : null}
                      {description ? (
                        <>
                          <small>{description.title}</small>
                          <small>{description.message}</small>
                          {description.actionLabel ? (
                            <small>{description.actionLabel}</small>
                          ) : null}
                        </>
                      ) : null}
                    </span>
                    <span className="collection-picker-row-state">
                      {active ? <Check aria-hidden="true" size={16} /> : null}
                      {unavailable
                        ? "Not available"
                        : opening ||
                            openingCollectionId === connection.collectionId
                          ? "Opening…"
                          : active
                            ? "Current"
                            : "Open"}
                    </span>
                  </button>
                );
              })}
              {!visible.length ? (
                <p className="collection-picker-empty">
                  {connections.length
                    ? `No collections match “${search.trim()}”.`
                    : "No collections are connected to TaskNotes on this device yet."}
                </p>
              ) : null}
            </div>
          </div>
        </div>
        <footer className="collection-picker-footer">
          <button
            className="collection-picker-action"
            disabled={working}
            onClick={onAuthorize}
            type="button"
          >
            <span className="collection-picker-row-icon">
              <Plus aria-hidden="true" size={19} />
            </span>
            <span>
              <strong>Connect another collection</strong>
              <small>Open mdbase to choose and approve access.</small>
            </span>
            <ArrowRight aria-hidden="true" size={18} />
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
