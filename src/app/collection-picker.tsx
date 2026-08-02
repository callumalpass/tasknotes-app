import type { MdbaseConnectionInfo } from "@mdbase-dev/connect";
import {
  ArrowLeft,
  Check,
  Cloud,
  FolderOpen,
  HardDrive,
  Plus,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { OperationErrorNotice } from "../components/operation-error-notice";

import { isHostedCloudConnection } from "../cloud/connect";

import type { CollectionTransferProgress } from "../storage/collection-transfer";
import type { LocalCollectionLocation } from "../storage/local-collection-location";
import type { CollectionChoice } from "./collection-context";
import {
  isCollectionMigrationLocked,
  type CollectionMigrationState,
} from "./collection-migration-state";

export function CollectionPicker({
  activeChoice,
  activeLocalLocation,
  canChooseLocalFolder,
  cloudConnections,
  migration,
  rememberedExternal,
  selectedCloudCollectionId,
  onAuthorizeCloud,
  onAuthorizeMigration,
  onBackFromMigration,
  onChooseFolder,
  onClose,
  onFinishMigration,
  onMoveToMdbase,
  onRetryMigration,
  onSelectCloud,
  onSelectLocal,
}: {
  activeChoice: CollectionChoice;
  activeLocalLocation: LocalCollectionLocation;
  canChooseLocalFolder: boolean;
  cloudConnections: MdbaseConnectionInfo[];
  migration: CollectionMigrationState | null;
  rememberedExternal?: Extract<LocalCollectionLocation, { mode: "external" }>;
  selectedCloudCollectionId: string | null;
  onAuthorizeCloud(): void;
  onAuthorizeMigration(): void;
  onBackFromMigration(): void;
  onChooseFolder(): void;
  onClose(): void;
  onFinishMigration(): void;
  onMoveToMdbase(): void;
  onRetryMigration(): void;
  onSelectCloud(collectionId: string): void;
  onSelectLocal(location: LocalCollectionLocation): void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const migrationLocked = isCollectionMigrationLocked(migration);

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
        if (migrationLocked) return;
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = [
        ...(dialogRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ) ?? []),
      ];
      if (!controls.length) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = controls[0];
      const last = controls.at(-1);
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          !dialogRef.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          !dialogRef.current?.contains(document.activeElement))
      ) {
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
  }, [migrationLocked, onClose]);

  return createPortal(
    <div
      className="collection-picker-scrim"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !migrationLocked) onClose();
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
        {migration ? (
          <MigrationPicker
            closeRef={closeRef}
            migration={migration}
            onAuthorize={onAuthorizeMigration}
            onBack={onBackFromMigration}
            onClose={onClose}
            onFinish={onFinishMigration}
            onRetry={onRetryMigration}
          />
        ) : (
          <>
            <header className="collection-picker-header">
              <div>
                <h2 id="collection-picker-title">Collections</h2>
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
              {canChooseLocalFolder ? (
                <CollectionGroup label="On this device">
                  <CollectionRow
                    active={
                      activeChoice === "local" &&
                      activeLocalLocation.mode === "default"
                    }
                    detail="Private TaskNotes folder"
                    icon={<HardDrive aria-hidden="true" size={20} />}
                    label="TaskNotes folder"
                    onClick={() => onSelectLocal({ mode: "default" })}
                  />
                  {rememberedExternal ? (
                    <CollectionRow
                      active={
                        activeChoice === "local" &&
                        activeLocalLocation.mode === "external" &&
                        activeLocalLocation.id === rememberedExternal.id
                      }
                      detail="Folder in Files"
                      icon={<FolderOpen aria-hidden="true" size={20} />}
                      label={rememberedExternal.name}
                      onClick={() => onSelectLocal(rememberedExternal)}
                    />
                  ) : null}
                  <CollectionAction
                    icon={<Plus aria-hidden="true" size={19} />}
                    label="Choose another folder"
                    onClick={onChooseFolder}
                  />
                </CollectionGroup>
              ) : null}

              <CollectionGroup label="mdbase">
                {cloudConnections.map((connection) => (
                  <CollectionRow
                    active={
                      activeChoice === "cloud" &&
                      selectedCloudCollectionId === connection.collectionId
                    }
                    detail={
                      isHostedCloudConnection(connection)
                        ? "Hosted by mdbase"
                        : "Connected computer"
                    }
                    icon={<Cloud aria-hidden="true" size={20} />}
                    key={connection.collectionId}
                    label={connection.displayName}
                    onClick={() => onSelectCloud(connection.collectionId)}
                  />
                ))}
                {!cloudConnections.length ? (
                  <p className="collection-picker-empty">
                    No mdbase collections have been opened on this device.
                  </p>
                ) : null}
                <CollectionAction
                  icon={<Plus aria-hidden="true" size={19} />}
                  label="Connect another collection"
                  onClick={onAuthorizeCloud}
                />
              </CollectionGroup>
            </div>

            {activeChoice === "local" ? (
              <footer className="collection-picker-transfer">
                <button
                  className="collection-transfer-action"
                  onClick={onMoveToMdbase}
                  type="button"
                >
                  <Upload aria-hidden="true" size={20} />
                  <span>
                    <strong>Move this collection to mdbase</strong>
                    <small>
                      Upload a checked copy, then use hosted mdbase as the
                      source of truth.
                    </small>
                  </span>
                </button>
              </footer>
            ) : null}
          </>
        )}
      </section>
    </div>,
    document.body,
  );
}

function MigrationPicker({
  closeRef,
  migration,
  onAuthorize,
  onBack,
  onClose,
  onFinish,
  onRetry,
}: {
  closeRef: React.RefObject<HTMLButtonElement | null>;
  migration: CollectionMigrationState;
  onAuthorize(): void;
  onBack(): void;
  onClose(): void;
  onFinish(): void;
  onRetry(): void;
}) {
  const locked = isCollectionMigrationLocked(migration);
  return (
    <>
      <header className="collection-picker-header">
        <button
          aria-label="Back to collections"
          className="icon-action"
          disabled={locked}
          onClick={onBack}
          title="Back to collections"
          type="button"
        >
          <ArrowLeft aria-hidden="true" size={20} />
        </button>
        <div>
          <h2 id="collection-picker-title">Move to mdbase</h2>
        </div>
        <button
          aria-label="Close collection picker"
          className="icon-action"
          disabled={locked}
          onClick={onClose}
          ref={closeRef}
          title="Close collections"
          type="button"
        >
          <X aria-hidden="true" size={20} />
        </button>
      </header>

      {migration.step === "destination" ? (
        <div className="collection-picker-content migration-destinations">
          <p className="collection-transfer-copy">
            mdbase will upload and check a complete copy of this collection.
            TaskNotes keeps using the local files until that copy is ready.
          </p>
          <CollectionGroup label="What moves">
            <p className="collection-picker-empty">
              Markdown tasks, collection settings, and saved views move
              together. After the switch, the original local files remain as a
              read-only archive.
            </p>
            <CollectionAction
              icon={<Cloud aria-hidden="true" size={19} />}
              label="Continue with mdbase"
              onClick={onAuthorize}
            />
          </CollectionGroup>
        </div>
      ) : migration.step === "authorizing" ? (
        <MigrationStatus
          detail="Approve TaskNotes access to the newly hosted collection. You will return here automatically."
          label="Hosted collection is ready"
        />
      ) : migration.step === "running" ? (
        <MigrationStatus
          detail={transferProgressLabel(migration.progress)}
          label={`Moving to ${migration.destinationName}`}
          progress={migration.progress}
          verificationUri={migration.verificationUri}
        />
      ) : migration.step === "error" ? (
        <div className="collection-transfer-result">
          <p className="transfer-result-mark error" aria-hidden="true">
            !
          </p>
          <h3>
            {migration.mustResume
              ? "The move needs your attention."
              : "Nothing was removed locally."}
          </h3>
          <OperationErrorNotice
            action="The collection move"
            message={migration.message}
            recovery={
              migration.canRetry
                ? "Your local collection is unchanged. Retry when ready."
                : "Your local collection is unchanged."
            }
          />
          <div className="collection-transfer-buttons">
            {migration.canRetry ? (
              <button
                className="outline-action"
                onClick={onRetry}
                type="button"
              >
                Retry transfer
              </button>
            ) : null}
            {!migration.mustResume ? (
              <button className="text-action" onClick={onBack} type="button">
                Back to collection details
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="collection-transfer-result">
          <p className="transfer-result-mark success" aria-hidden="true">
            <Check size={26} />
          </p>
          <h3>{migration.destinationName} is hosted.</h3>
          <p>
            {migration.result.records.toLocaleString()}{" "}
            {migration.result.records === 1 ? "record" : "records"} and{" "}
            {migration.result.views.toLocaleString()} saved{" "}
            {migration.result.views === 1 ? "view" : "views"} adopted as one
            checked copy. The original local collection is a read-only archive;
            hosted mdbase is now the source of truth.
          </p>
          <button className="outline-action" onClick={onFinish} type="button">
            Open hosted collection
          </button>
        </div>
      )}
    </>
  );
}

function CollectionGroup({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <section className="collection-picker-group">
      <h3>{label}</h3>
      <div>{children}</div>
    </section>
  );
}

function CollectionRow({
  active,
  detail,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  detail: string;
  icon: React.ReactNode;
  label: string;
  onClick(): void;
}) {
  return (
    <button
      aria-current={active ? "true" : undefined}
      className={
        active ? "collection-picker-row current" : "collection-picker-row"
      }
      onClick={onClick}
      type="button"
    >
      <span className="collection-picker-row-icon">{icon}</span>
      <span>
        <strong>{label}</strong>
        <small>{active ? "Open now" : detail}</small>
      </span>
      {active ? (
        <Check aria-hidden="true" className="collection-row-check" size={19} />
      ) : (
        <span className="collection-row-open">Open</span>
      )}
    </button>
  );
}

function CollectionAction({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick(): void;
}) {
  return (
    <button
      className="collection-picker-row collection-picker-action"
      onClick={onClick}
      type="button"
    >
      <span className="collection-picker-row-icon">{icon}</span>
      <strong>{label}</strong>
    </button>
  );
}

function MigrationStatus({
  detail,
  label,
  progress,
  verificationUri,
}: {
  detail: string;
  label: string;
  progress?: CollectionTransferProgress;
  verificationUri?: string;
}) {
  const value =
    progress && progress.total
      ? Math.round((progress.completed / progress.total) * 100)
      : undefined;
  return (
    <div
      className="collection-transfer-status"
      aria-live="polite"
      role="status"
    >
      <Upload aria-hidden="true" size={28} strokeWidth={1.5} />
      <h3>{label}</h3>
      <p>{detail}</p>
      {verificationUri ? (
        <p>
          <a href={verificationUri} rel="noopener noreferrer" target="_blank">
            Open mdbase approval
          </a>
        </p>
      ) : null}
      {value === undefined ? null : (
        <progress
          aria-label="Collection transfer progress"
          max={100}
          value={value}
        >
          {value}%
        </progress>
      )}
      <small>Keep TaskNotes open until verification finishes.</small>
    </div>
  );
}

function transferProgressLabel(progress: CollectionTransferProgress): string {
  switch (progress.phase) {
    case "reading":
      return "Reading the local Markdown collection.";
    case "approving":
      return "Waiting for your approval.";
    case "uploading":
      return progress.total
        ? `Uploading file ${progress.completed.toLocaleString()} of ${progress.total.toLocaleString()}.`
        : "Uploading the collection copy.";
    case "fencing":
      return "Pausing edits briefly and checking for final changes.";
    case "activating":
      return "Making the checked hosted copy the source of truth.";
    case "authorizing":
      return "Connecting TaskNotes to the hosted collection.";
  }
}
