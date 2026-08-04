import type { MdbaseConnectionInfo } from "@mdbase-dev/connect";
import { Check, Cloud, Plus, X } from "lucide-react";
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
    queueMicrotask(() => closeRef.current?.focus());
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
          <h2 id="collection-picker-title">Collections</h2>
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
            <span className="collection-picker-group-label">mdbase</span>
            {connections.map((connection) => {
              const active = connection.collectionId === selectedCollectionId;
              return (
                <button
                  aria-current={active ? "true" : undefined}
                  className={`collection-picker-row${active ? " is-active" : ""}`}
                  key={connection.collectionId}
                  onClick={() => onSelect(connection.collectionId)}
                  type="button"
                >
                  <Cloud aria-hidden="true" size={20} />
                  <span>
                    <strong>{connection.displayName}</strong>
                    <small>
                      {isHostedCloudConnection(connection)
                        ? "Hosted by mdbase"
                        : "Connected computer"}
                    </small>
                  </span>
                  {active ? <Check aria-hidden="true" size={18} /> : null}
                </button>
              );
            })}
            {!connections.length ? (
              <p className="collection-picker-empty">
                No mdbase collections have been opened on this device.
              </p>
            ) : null}
            <button
              className="collection-picker-action"
              onClick={onAuthorize}
              type="button"
            >
              <Plus aria-hidden="true" size={19} />
              <span>Connect another collection</span>
            </button>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}
