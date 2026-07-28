import { App as CapacitorApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import {
  ArrowLeft,
  BellOff,
  BellRing,
  Check,
  Cloud,
  FileText,
  FolderOpen,
  HardDrive,
  Search,
  Smartphone,
} from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  authorizeCloudCollection,
  cleanCallbackUrl,
  cloudControlUrl,
  completeCloudAuthorization,
  isCloudCallback,
  savedCloudConnections,
  selectedCloudCollectionId,
  selectCloudConnection,
} from "../cloud/connect";
import { MarkdownCollection } from "../storage/collection";
import {
  transferLocalCollectionToHosted,
  type CollectionTransferCheckpoint,
  type CollectionTransferProgress,
  type CollectionTransferResult,
} from "../storage/collection-transfer";
import {
  chooseDefaultLocalCollection,
  chooseExistingLocalCollection,
  localCollectionKey,
  readLocalCollectionLocation,
  readRememberedExternalCollection,
  selectLocalCollectionLocation,
  type LocalCollectionLocation,
} from "../storage/local-collection-location";
import { createPlatformVault } from "../storage/vault";
import { tasknotesMarkUrl } from "./assets";
import {
  isCollectionMigrationLocked,
  type CollectionMigrationState,
} from "./collection-migration-state";
import { CollectionPicker } from "./collection-picker";
import type { CollectionChoice } from "./collection-context";

const CloudCollection = lazy(() => import("./cloud-collection"));
const LocalCollection = lazy(() => import("./local-collection"));
const STORAGE_KEY = "tasknotes:collection-choice:v1";
const TRANSFER_KEY = "tasknotes:local-to-hosted-transfer:v1";

export function CollectionGate() {
  const canChooseLocalFolder = Capacitor.isNativePlatform();
  const [choice, setChoice] = useState<CollectionChoice | null>(() =>
    readChoice(),
  );
  const [localLocation, setLocalLocation] = useState<LocalCollectionLocation>(
    () => readLocalCollectionLocation(),
  );
  const [choosingLocalLocation, setChoosingLocalLocation] = useState(false);
  const [confirmingBrowserLocal, setConfirmingBrowserLocal] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [migration, setMigration] = useState<CollectionMigrationState | null>(
    null,
  );
  const [migrationTarget, setMigrationTarget] = useState<{
    collectionId: string;
    displayName: string;
  } | null>(null);
  const [authorizationError, setAuthorizationError] = useState<string | null>(
    null,
  );
  const callbackInFlight = useRef<string | null>(null);
  const transferInFlight = useRef(false);
  const localChoiceReturnsToPicker = useRef(false);
  const choose = useCallback((next: CollectionChoice) => {
    localStorage.setItem(STORAGE_KEY, next);
    setChoice(next);
  }, []);
  const reset = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setChoice(null);
  }, []);
  const changeLocalCollection = useCallback(() => {
    localChoiceReturnsToPicker.current = true;
    setPickerOpen(false);
    setChoosingLocalLocation(true);
  }, []);
  const finishLocalChoice = useCallback((location: LocalCollectionLocation) => {
    setLocalLocation(location);
    localStorage.setItem(STORAGE_KEY, "local");
    setChoice("local");
    setChoosingLocalLocation(false);
  }, []);

  const finishBrowserCallback = useCallback(async () => {
    if (Capacitor.isNativePlatform())
      await Browser.close().catch(() => undefined);
    else cleanCallbackUrl();
  }, []);

  const runTransfer = useCallback(
    async (
      sourceLocation: LocalCollectionLocation,
      checkpoint?: CollectionTransferCheckpoint,
    ) => {
      if (transferInFlight.current) return;
      const displayName =
        sourceLocation.mode === "external" ? sourceLocation.name : "TaskNotes";
      const sourceName = Capacitor.isNativePlatform()
        ? sourceLocation.mode === "external"
          ? `${sourceLocation.name} on this phone`
          : "TaskNotes on this phone"
        : "TaskNotes in this browser";
      let transferProgress: CollectionTransferProgress = {
        phase: "reading",
        completed: 0,
        total: 1,
      };
      let verificationUri: string | undefined;
      transferInFlight.current = true;
      setPickerOpen(true);
      setMigration({
        step: "running",
        destinationName: displayName,
        progress: transferProgress,
      });
      savePendingTransfer({
        sourceLocation,
        ...(checkpoint ? { checkpoint } : {}),
      });
      try {
        const source = new MarkdownCollection(
          createPlatformVault(sourceLocation),
        );
        const result = await transferLocalCollectionToHosted({
          source,
          controlUrl: cloudControlUrl(),
          displayName,
          sourceName,
          ...(checkpoint ? { checkpoint } : {}),
          onCheckpoint: (nextCheckpoint) =>
            savePendingTransfer({
              sourceLocation,
              checkpoint: nextCheckpoint,
            }),
          onCheckpointCleared: clearPendingTransfer,
          onVerification: async (verification) => {
            verificationUri = verification.verificationUri;
            setMigration({
              step: "running",
              destinationName: displayName,
              progress: transferProgress,
              verificationUri,
            });
            if (Capacitor.isNativePlatform())
              await Browser.open({ url: verification.verificationUri });
            else
              window.open(
                verification.verificationUri,
                "_blank",
                "noopener,noreferrer",
              );
          },
          onProgress: (progress: CollectionTransferProgress) => {
            transferProgress = progress;
            setMigration({
              step: "running",
              destinationName: displayName,
              progress,
              ...(verificationUri ? { verificationUri } : {}),
            });
          },
        });
        setMigrationTarget({
          collectionId: result.destinationCollectionId,
          displayName,
        });
        savePendingTransfer({
          sourceLocation,
          adoptedCollectionId: result.destinationCollectionId,
          result,
          displayName,
        });
        setMigration({
          step: "authorizing",
        });
        await authorizeCloudCollection(result.destinationCollectionId);
      } catch (reason) {
        const pending = readPendingTransfer();
        setMigration({
          step: "error",
          destinationName: displayName,
          message: message(reason),
          canRetry: true,
          ...(requiresAuthorityResolution(reason) ||
          Boolean(pending?.checkpoint?.snapshot) ||
          Boolean(pending?.adoptedCollectionId)
            ? { mustResume: true }
            : {}),
        });
      } finally {
        transferInFlight.current = false;
      }
    },
    [],
  );

  const complete = useCallback(
    async (url: string) => {
      if (!isCloudCallback(url) || callbackInFlight.current === url) return;
      callbackInFlight.current = url;
      const pending = readPendingTransfer();
      try {
        const connection = await completeCloudAuthorization(url);
        await finishBrowserCallback();
        setAuthorizationError(null);
        if (pending?.adoptedCollectionId) {
          const info = connection.info();
          if (!info || connection.collectionId !== pending.adoptedCollectionId)
            throw new Error(
              "TaskNotes was connected to a different collection after adoption.",
            );
          selectCloudConnection(connection.collectionId, true);
          setMigrationTarget({
            collectionId: connection.collectionId,
            displayName: pending.displayName ?? info.displayName,
          });
          setPickerOpen(true);
          setMigration({
            step: "complete",
            destinationName: pending.displayName ?? info.displayName,
            result:
              pending.result ??
              ({
                records: 0,
                views: 0,
                destinationCollectionId: connection.collectionId,
              } satisfies CollectionTransferResult),
          });
        } else if (pending?.checkpoint) {
          await runTransfer(pending.sourceLocation, pending.checkpoint);
        } else {
          choose("cloud");
          setPickerOpen(false);
        }
      } catch (reason) {
        await finishBrowserCallback();
        if (pending) {
          setPickerOpen(true);
          setMigration({
            step: "error",
            message: message(reason),
            canRetry: Boolean(
              pending.checkpoint || pending.adoptedCollectionId,
            ),
            ...(pending.adoptedCollectionId || pending.checkpoint?.snapshot
              ? { mustResume: true }
              : {}),
          });
        } else {
          setAuthorizationError(message(reason));
          choose("cloud");
        }
      } finally {
        callbackInFlight.current = null;
      }
    },
    [choose, finishBrowserCallback, runTransfer],
  );

  useEffect(() => {
    if (isCloudCallback(location.href)) {
      const callbackUrl = location.href;
      queueMicrotask(() => void complete(callbackUrl));
    } else {
      const pending = readPendingTransfer();
      if (pending?.checkpoint)
        queueMicrotask(
          () => void runTransfer(pending.sourceLocation, pending.checkpoint),
        );
      else if (pending?.adoptedCollectionId) {
        queueMicrotask(() => {
          setPickerOpen(true);
          setMigration({ step: "authorizing" });
          void authorizeCloudCollection(pending.adoptedCollectionId).catch(
            (reason) =>
              setMigration({
                step: "error",
                message: message(reason),
                canRetry: true,
                mustResume: true,
              }),
          );
        });
      }
    }
    if (!Capacitor.isNativePlatform()) return;
    const listeners = [
      CapacitorApp.addListener("appUrlOpen", ({ url }) => void complete(url)),
    ];
    void CapacitorApp.getLaunchUrl().then((value) => {
      if (value?.url) void complete(value.url);
    });
    return () => {
      for (const listener of listeners)
        void listener.then((handle) => handle.remove());
    };
  }, [complete, runTransfer]);

  const closePicker = useCallback(() => {
    if (isCollectionMigrationLocked(migration)) return;
    setPickerOpen(false);
    setMigration(null);
    setMigrationTarget(null);
    clearPendingTransfer();
  }, [migration]);

  const selectLocal = useCallback(
    async (location: LocalCollectionLocation) => {
      const selected =
        location.mode === "default"
          ? await chooseDefaultLocalCollection()
          : (selectLocalCollectionLocation(location), location);
      if (choice === "cloud") await disableMdbaseNotifications();
      finishLocalChoice(selected);
      setPickerOpen(false);
    },
    [choice, finishLocalChoice],
  );

  const selectCloud = useCallback(
    async (collectionId: string) => {
      if (choice === "cloud" && selectedCloudCollectionId() === collectionId) {
        setPickerOpen(false);
        return;
      }
      if (choice === "cloud") await disableMdbaseNotifications();
      selectCloudConnection(collectionId, true);
      choose("cloud");
      setPickerOpen(false);
    },
    [choice, choose],
  );

  function authorizeAnotherCloudCollection() {
    clearPendingTransfer();
    setPickerOpen(false);
    choose("cloud");
    setAuthorizationError(null);
    void authorizeCloudCollection().catch((reason) =>
      setAuthorizationError(message(reason)),
    );
  }

  function reauthorizeCurrentCloudCollection() {
    clearPendingTransfer();
    setPickerOpen(false);
    choose("cloud");
    setAuthorizationError(null);
    void authorizeCloudCollection(
      selectedCloudCollectionId() ?? undefined,
    ).catch((reason) => setAuthorizationError(message(reason)));
  }

  function authorizeMigrationDestination() {
    void runTransfer(localLocation);
  }

  function retryMigration() {
    const pending = readPendingTransfer();
    if (!pending) {
      void runTransfer(localLocation);
      return;
    }
    if (pending.adoptedCollectionId) {
      setMigration({ step: "authorizing" });
      void authorizeCloudCollection(pending.adoptedCollectionId).catch(
        (reason) =>
          setMigration({
            step: "error",
            message: message(reason),
            canRetry: true,
            mustResume: true,
          }),
      );
      return;
    }
    void runTransfer(pending.sourceLocation, pending.checkpoint);
  }

  function finishMigration() {
    if (!migrationTarget) return;
    clearPendingTransfer();
    selectCloudConnection(migrationTarget.collectionId, true);
    choose("cloud");
    setMigration(null);
    setMigrationTarget(null);
    setPickerOpen(false);
  }

  if (choosingLocalLocation)
    return (
      <LocalLocationChoice
        onBack={() => {
          setChoosingLocalLocation(false);
          if (localChoiceReturnsToPicker.current) setPickerOpen(true);
        }}
        onChooseDefault={async () =>
          finishLocalChoice(await chooseDefaultLocalCollection())
        }
        onChooseExisting={async () => {
          const location = await chooseExistingLocalCollection();
          if (location) finishLocalChoice(location);
        }}
      />
    );

  if (confirmingBrowserLocal)
    return (
      <BrowserLocalConfirmation
        onBack={() => setConfirmingBrowserLocal(false)}
        onConfirm={() => {
          setConfirmingBrowserLocal(false);
          choose("local");
        }}
      />
    );

  if (!choice)
    return (
      <CollectionWelcome
        canChooseLocalFolder={canChooseLocalFolder}
        onChooseCloud={() => choose("cloud")}
        onChooseLocal={() => {
          if (canChooseLocalFolder) setChoosingLocalLocation(true);
          else setConfirmingBrowserLocal(true);
        }}
      />
    );
  const opened =
    choice === "cloud" ? (
      <Suspense fallback={<OpeningCollection label="Opening mdbase" />}>
        <CloudCollection
          authorizeAnotherCloudCollection={authorizeAnotherCloudCollection}
          authorizationError={authorizationError}
          canChooseLocalFolder={canChooseLocalFolder}
          changeLocalCollection={changeLocalCollection}
          choose={choose}
          openCollectionPicker={() => setPickerOpen(true)}
          reauthorizeCurrentCloudCollection={reauthorizeCurrentCloudCollection}
          reset={reset}
        />
      </Suspense>
    ) : (
      <Suspense fallback={<OpeningCollection label="Opening your tasks" />}>
        <LocalCollection
          authorizeAnotherCloudCollection={authorizeAnotherCloudCollection}
          canChooseLocalFolder={canChooseLocalFolder}
          changeLocalCollection={changeLocalCollection}
          choose={choose}
          key={localCollectionKey(localLocation)}
          openCollectionPicker={() => setPickerOpen(true)}
          reauthorizeCurrentCloudCollection={reauthorizeCurrentCloudCollection}
        />
      </Suspense>
    );

  return (
    <>
      {opened}
      {pickerOpen ? (
        <CollectionPicker
          activeChoice={choice}
          activeLocalLocation={localLocation}
          canChooseLocalFolder={canChooseLocalFolder}
          cloudConnections={savedCloudConnections()}
          migration={migration}
          rememberedExternal={readRememberedExternalCollection()}
          selectedCloudCollectionId={selectedCloudCollectionId()}
          onAuthorizeCloud={authorizeAnotherCloudCollection}
          onAuthorizeMigration={authorizeMigrationDestination}
          onBackFromMigration={() => {
            if (isCollectionMigrationLocked(migration)) return;
            clearPendingTransfer();
            setMigration(null);
            setMigrationTarget(null);
          }}
          onChooseFolder={changeLocalCollection}
          onClose={closePicker}
          onFinishMigration={finishMigration}
          onMoveToMdbase={() => setMigration({ step: "destination" })}
          onRetryMigration={retryMigration}
          onSelectCloud={(collectionId) => void selectCloud(collectionId)}
          onSelectLocal={(location) => void selectLocal(location)}
        />
      ) : null}
    </>
  );
}

function CollectionWelcome({
  canChooseLocalFolder,
  onChooseCloud,
  onChooseLocal,
}: {
  canChooseLocalFolder: boolean;
  onChooseCloud(): void;
  onChooseLocal(): void;
}) {
  return (
    <main className="collection-welcome">
      <div className="welcome-copy">
        <img alt="" src={tasknotesMarkUrl} />
        <p className="eyebrow">TaskNotes</p>
        <h1>Choose how TaskNotes stores your tasks.</h1>
        <p>
          This affects notification delivery, performance as your collection
          grows, and where your Markdown files live.
        </p>
      </div>
      <div className="collection-choices collection-choice-comparison">
        <button
          className="collection-choice recommended"
          type="button"
          onClick={onChooseCloud}
        >
          <Cloud aria-hidden="true" size={22} strokeWidth={1.5} />
          <span className="collection-choice-content">
            <span className="collection-choice-title">
              <strong>mdbase</strong>
              <span className="recommendation-label">Best experience</span>
            </span>
            <span className="collection-choice-benefits">
              <small>
                <Search aria-hidden="true" size={15} />
                Faster search and saved views as your collection grows
              </small>
              <small>
                <BellRing aria-hidden="true" size={15} />
                mdbase delivers reminders while TaskNotes is closed
              </small>
              <small>
                <Check aria-hidden="true" size={15} />
                Hosted sync or a direct connection to your computer
              </small>
            </span>
            <span className="collection-choice-action">Connect mdbase</span>
          </span>
        </button>
        <button
          className="collection-choice"
          type="button"
          onClick={onChooseLocal}
        >
          <HardDrive aria-hidden="true" size={22} strokeWidth={1.5} />
          <span className="collection-choice-content">
            <strong>On this device</strong>
            <span className="collection-choice-benefits">
              <small>
                <FileText aria-hidden="true" size={15} />
                {canChooseLocalFolder
                  ? "Use a folder and its Markdown files directly"
                  : "Keep Markdown in this browser on this device"}
              </small>
              <small>
                <BellOff aria-hidden="true" size={15} />
                Reminder details are saved, but notifications are not delivered
              </small>
              <small>
                <Smartphone aria-hidden="true" size={15} />
                No account required
              </small>
            </span>
            <span className="collection-choice-action">
              Use {canChooseLocalFolder ? "this device" : "this browser"}
            </span>
          </span>
        </button>
      </div>
      <p className="welcome-portability">
        <FileText aria-hidden="true" size={16} /> Both options use portable
        Markdown. Switching later does not move tasks between collections.
      </p>
    </main>
  );
}

function BrowserLocalConfirmation({
  onBack,
  onConfirm,
}: {
  onBack(): void;
  onConfirm(): void;
}) {
  return (
    <main className="collection-welcome browser-local-welcome">
      <div className="welcome-copy">
        <img alt="" src={tasknotesMarkUrl} />
        <p className="eyebrow">On this device</p>
        <h1>Keep tasks in this browser?</h1>
        <p>
          This is a private, account-free option for one browser. It is best for
          smaller collections.
        </p>
      </div>
      <div className="collection-caveat" role="note">
        <BellOff aria-hidden="true" size={20} />
        <div>
          <strong>Notifications are not available</strong>
          <p>
            Reminder details remain in Markdown, but this browser cannot deliver
            task notifications. Clearing its site data can also remove the
            browser-held collection.
          </p>
        </div>
      </div>
      <div className="welcome-actions">
        <button className="outline-action" type="button" onClick={onConfirm}>
          Use this browser
        </button>
        <button className="text-action" type="button" onClick={onBack}>
          <ArrowLeft aria-hidden="true" size={17} />
          Back
        </button>
      </div>
    </main>
  );
}

function LocalLocationChoice({
  onBack,
  onChooseDefault,
  onChooseExisting,
}: {
  onBack(): void;
  onChooseDefault(): Promise<void>;
  onChooseExisting(): Promise<void>;
}) {
  const [opening, setOpening] = useState<"default" | "existing" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(
    kind: "default" | "existing",
    operation: () => Promise<void>,
  ) {
    setOpening(kind);
    setError(null);
    try {
      await operation();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setOpening(null);
    }
  }

  return (
    <main className="collection-welcome local-location-welcome">
      <div className="welcome-copy">
        <img alt="" src={tasknotesMarkUrl} />
        <p className="eyebrow">On this device</p>
        <h1>Use a folder for your tasks.</h1>
        <p>
          TaskNotes can use its usual folder or a compatible collection you
          already have.
        </p>
      </div>
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="collection-choices">
        <button
          disabled={opening !== null}
          type="button"
          onClick={() => void choose("default", onChooseDefault)}
        >
          <HardDrive aria-hidden="true" size={22} strokeWidth={1.5} />
          <span>
            <strong>Use the TaskNotes folder</strong>
            <small>
              {opening === "default"
                ? "Opening…"
                : "Keep an app-managed folder that is visible in Files."}
            </small>
          </span>
        </button>
        <button
          disabled={opening !== null}
          type="button"
          onClick={() => void choose("existing", onChooseExisting)}
        >
          <FolderOpen aria-hidden="true" size={22} strokeWidth={1.5} />
          <span>
            <strong>Choose an existing folder</strong>
            <small>
              {opening === "existing"
                ? "Waiting for Files…"
                : "Open a local, iCloud, or supported provider folder."}
            </small>
          </span>
        </button>
      </div>
      <button
        className="welcome-back text-action"
        type="button"
        onClick={onBack}
      >
        <ArrowLeft aria-hidden="true" size={17} />
        Back
      </button>
    </main>
  );
}

function OpeningCollection({ label }: { label: string }) {
  return (
    <main className="opening-screen">
      <img alt="" src={tasknotesMarkUrl} />
      <p>{label}</p>
    </main>
  );
}

function readChoice(): CollectionChoice | null {
  const value = localStorage.getItem(STORAGE_KEY);
  return value === "local" || value === "cloud" ? value : null;
}

interface PendingCollectionTransfer {
  sourceLocation: LocalCollectionLocation;
  checkpoint?: CollectionTransferCheckpoint;
  adoptedCollectionId?: string;
  result?: CollectionTransferResult;
  displayName?: string;
}

function readPendingTransfer(): PendingCollectionTransfer | null {
  try {
    const value = JSON.parse(localStorage.getItem(TRANSFER_KEY) ?? "null") as {
      sourceLocation?: LocalCollectionLocation;
      checkpoint?: unknown;
      adoptedCollectionId?: unknown;
      result?: unknown;
      displayName?: unknown;
    } | null;
    if (
      !value?.sourceLocation ||
      (value.sourceLocation.mode !== "default" &&
        value.sourceLocation.mode !== "external")
    )
      return null;
    const checkpoint =
      value.checkpoint &&
      typeof value.checkpoint === "object" &&
      "session" in value.checkpoint
        ? (value.checkpoint as CollectionTransferCheckpoint)
        : undefined;
    const adoptedCollectionId =
      typeof value.adoptedCollectionId === "string"
        ? value.adoptedCollectionId
        : undefined;
    const result =
      value.result &&
      typeof value.result === "object" &&
      "destinationCollectionId" in value.result
        ? (value.result as CollectionTransferResult)
        : undefined;
    return {
      sourceLocation: value.sourceLocation,
      ...(checkpoint ? { checkpoint } : {}),
      ...(adoptedCollectionId ? { adoptedCollectionId } : {}),
      ...(result ? { result } : {}),
      ...(typeof value.displayName === "string"
        ? { displayName: value.displayName }
        : {}),
    };
  } catch {
    return null;
  }
}

function savePendingTransfer(value: PendingCollectionTransfer): void {
  localStorage.setItem(TRANSFER_KEY, JSON.stringify(value));
}

function clearPendingTransfer(): void {
  localStorage.removeItem(TRANSFER_KEY);
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function requiresAuthorityResolution(reason: unknown): boolean {
  return Boolean(
    reason &&
    typeof reason === "object" &&
    "sourceMustRemainFenced" in reason &&
    (reason as { sourceMustRemainFenced?: unknown }).sourceMustRemainFenced,
  );
}

async function disableMdbaseNotifications(): Promise<void> {
  const { mdbaseNotifications } =
    await import("../native/mdbase-notifications");
  await mdbaseNotifications.disableIfEnabled().catch(() => undefined);
}
