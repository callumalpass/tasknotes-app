import { useLingui, Trans } from "@lingui/react/macro";
import type { MdbaseConnectionInfo } from "@mdbase-dev/connect";
import { ArrowRight, Check, Cloud, Monitor, Plus, X } from "lucide-react";
import { useRef } from "react";
import { createPortal } from "react-dom";

import { isHostedCloudConnection } from "../cloud/connect";
import { useOverlay } from "../components/overlays/use-overlay";

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
  const { t } = useLingui();
  const closeRef = useRef<HTMLButtonElement>(null);
  const firstCollectionRef = useRef<HTMLButtonElement>(null);
  const selectedCollectionRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useOverlay({
    open: true,
    rootRef: dialogRef,
    modal: true,
    onDismiss: onClose,
    initialFocus: () =>
      selectedCollectionRef.current ??
      firstCollectionRef.current ??
      closeRef.current,
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
            <p className="eyebrow">
              <Trans>TaskNotes collection</Trans>
            </p>
            <h2 id="collection-picker-title">
              <Trans>Choose where to work</Trans>
            </h2>
            <p>
              <Trans>
                TaskNotes opens the collection at its authoritative location.
              </Trans>
            </p>
          </div>
          <button
            aria-label={t({ message: "Close collection picker" })}
            className="icon-action"
            onClick={onClose}
            ref={closeRef}
            title={t({ message: "Close collections" })}
            type="button"
          >
            <X aria-hidden="true" size={20} />
          </button>
        </header>
        <div className="collection-picker-content">
          <div className="collection-picker-group">
            <h3>
              <Trans>Available collections</Trans>
            </h3>
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
                        {hosted
                          ? t({ message: "Hosted by mdbase" })
                          : t({ message: "Connected computer" })}
                      </small>
                    </span>
                    <span className="collection-picker-row-state">
                      {active ? <Check aria-hidden="true" size={16} /> : null}
                      {active
                        ? t({ message: "Current" })
                        : t({ message: "Open" })}
                    </span>
                  </button>
                );
              })}
              {!connections.length ? (
                <p className="collection-picker-empty">
                  <Trans>
                    No collections are connected to TaskNotes on this device
                    yet.
                  </Trans>
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
              <strong>
                <Trans>Connect another collection</Trans>
              </strong>
              <small>
                <Trans>Open mdbase to choose and approve access.</Trans>
              </small>
            </span>
            <ArrowRight aria-hidden="true" size={18} />
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
