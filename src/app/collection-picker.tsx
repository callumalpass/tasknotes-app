import type { MdbaseConnectionInfo } from "@mdbase-dev/connect";
import { ArrowRight, Check, Cloud, Monitor, Plus, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { isHostedCloudConnection } from "../cloud/connect";

export function CollectionPicker({
  connections,
  selectedCollectionId,
  onAuthorize,
  onClose,
  onSelect,
}: {
  connections: MdbaseConnectionInfo[];
  selectedCollectionId: string | null;
  onAuthorize(): void;
  onClose(): void;
  onSelect(collectionId: string): void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const firstCollectionRef = useRef<HTMLButtonElement>(null);
  const selectedCollectionRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const appRoot = document.getElementById("root");
    const previousRootHidden = appRoot?.getAttribute("aria-hidden");
    const previousRootInert = appRoot?.inert ?? false;
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    document.body.style.overflow = "hidden";
    if (appRoot) {
      appRoot.inert = true;
      appRoot.setAttribute("aria-hidden", "true");
    }
    queueMicrotask(() =>
      (
        selectedCollectionRef.current ??
        firstCollectionRef.current ??
        closeRef.current
      )?.focus(),
    );
    const containFocus = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = [
        ...(dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ) ?? []),
      ];
      if (!controls.length) return;
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", containFocus);
    return () => {
      document.body.style.overflow = previousOverflow;
      if (appRoot) {
        appRoot.inert = previousRootInert;
        if (previousRootHidden == null) appRoot.removeAttribute("aria-hidden");
        else appRoot.setAttribute("aria-hidden", previousRootHidden);
      }
      window.removeEventListener("keydown", containFocus);
      queueMicrotask(() => returnFocusRef.current?.focus());
    };
  }, [onClose]);

  return createPortal(
    <div
      className="collection-picker-scrim"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
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
            <p>TaskNotes opens the collection at its authoritative location.</p>
          </div>
          <button
            aria-label="Close collection picker"
            className="icon-action"
            onClick={onClose}
            ref={closeRef}
            title="Close collections"
            type="button"
          >
            <X aria-hidden="true" size={20} />
          </button>
        </header>
        <div className="collection-picker-content">
          <div className="collection-picker-group">
            <h3>Available collections</h3>
            <div>
              {connections.map((connection, index) => {
                const active = connection.collectionId === selectedCollectionId;
                const hosted = isHostedCloudConnection(connection);
                return (
                  <button
                    aria-current={active ? "true" : undefined}
                    className={`collection-picker-row${active ? " current" : ""}`}
                    key={connection.collectionId}
                    onClick={() => onSelect(connection.collectionId)}
                    ref={(element) => {
                      if (index === 0) firstCollectionRef.current = element;
                      if (active) selectedCollectionRef.current = element;
                    }}
                    type="button"
                  >
                    <span className="collection-picker-row-icon">
                      {hosted ? (
                        <Cloud aria-hidden="true" size={19} />
                      ) : (
                        <Monitor aria-hidden="true" size={19} />
                      )}
                    </span>
                    <span>
                      <strong>{connection.displayName}</strong>
                      <small>
                        {hosted ? "Hosted by mdbase" : "Connected computer"}
                      </small>
                    </span>
                    <span className="collection-picker-row-state">
                      {active ? <Check aria-hidden="true" size={16} /> : null}
                      {active ? "Current" : "Open"}
                    </span>
                  </button>
                );
              })}
              {!connections.length ? (
                <p className="collection-picker-empty">
                  No collections are connected to TaskNotes on this device yet.
                </p>
              ) : null}
            </div>
          </div>
        </div>
        <footer className="collection-picker-footer">
          <button
            className="collection-picker-action"
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
