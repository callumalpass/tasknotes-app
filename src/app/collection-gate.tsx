import {
  ArrowLeft,
  BellOff,
  BellRing,
  Cloud,
  FileText,
  FolderOpen,
  HardDrive,
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
  cloudSession,
  cloudControlUrl,
  isCloudCallback,
} from "../cloud/connect";
import { useCloudSessionSnapshot } from "../cloud/use-session";
import { appPlatform } from "../native/app-platform";
import {
  type CollectionTransferCheckpoint,
  type CollectionTransferProgress,
  type CollectionTransferResult,
} from "../storage/collection-transfer";
import { OperationErrorNotice } from "../components/operation-error-notice";
import { transferPlatformLocalCollectionToHosted } from "../storage/local-collection-transfer";
import {
  chooseDefaultLocalCollection,
  chooseExistingLocalCollection,
  canChooseLocalCollectionFolder,
  localCollectionKey,
  readLocalCollectionLocation,
  readRememberedExternalCollection,
  selectLocalCollectionLocation,
  type LocalCollectionLocation,
} from "../storage/local-collection-location";
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
  const canChooseLocalFolder = canChooseLocalCollectionFolder();
  const [choice, setChoice] = useState<CollectionChoice | null>(() =>
    readChoice(canChooseLocalFolder),
  );
  const [localLocation, setLocalLocation] = useState<LocalCollectionLocation>(
    () => readLocalCollectionLocation(),
  );
  const [choosingLocalLocation, setChoosingLocalLocation] = useState(false);
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
  const handledCallbackUrls = useRef(new Set<string>());
  const transferInFlight = useRef(false);
  const localChoiceReturnsToPicker = useRef(false);
  const cloud = useCloudSessionSnapshot();
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
    await appPlatform.closeAuthorizationBrowser();
  }, []);

  const runTransfer = useCallback(
    async (
      sourceLocation: LocalCollectionLocation,
      checkpoint?: CollectionTransferCheckpoint,
    ) => {
      if (transferInFlight.current) return;
      const displayName =
        sourceLocation.mode === "external" ? sourceLocation.name : "TaskNotes";
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
        const result = await transferPlatformLocalCollectionToHosted({
          sourceLocation,
          controlUrl: cloudControlUrl(),
          displayName,
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
            await appPlatform.openExternalUrl(verification.verificationUri);
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
        await cloudSession.authorize({
          collectionId: result.destinationCollectionId,
        });
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
      if (!isCloudCallback(url) || handledCallbackUrls.current.has(url)) return;
      handledCallbackUrls.current.add(url);
      const pending = readPendingTransfer();
      let callbackBrowserClosed = false;
      const closeCallbackBrowser = async () => {
        if (callbackBrowserClosed) return;
        callbackBrowserClosed = true;
        await finishBrowserCallback();
      };
      try {
        const connection = await cloudSession.handleAuthorizationCallback(url);
        await closeCallbackBrowser();
        setAuthorizationError(null);
        if (pending?.adoptedCollectionId) {
          const info = connection.info();
          if (!info || connection.collectionId !== pending.adoptedCollectionId)
            throw new Error(
              "TaskNotes was connected to a different collection after adoption.",
            );
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
        await closeCallbackBrowser();
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
      }
    },
    [choose, finishBrowserCallback, runTransfer],
  );

  useEffect(() => {
    const resume = () => {
      const pending = readPendingTransfer();
      if (pending?.checkpoint)
        queueMicrotask(
          () => void runTransfer(pending.sourceLocation, pending.checkpoint),
        );
      else if (pending?.adoptedCollectionId) {
        const adoptedCollectionId = pending.adoptedCollectionId;
        queueMicrotask(() => {
          setPickerOpen(true);
          setMigration({ step: "authorizing" });
          void cloudSession
            .authorize({ collectionId: adoptedCollectionId })
            .catch((reason) =>
              setMigration({
                step: "error",
                message: message(reason),
                canRetry: true,
                mustResume: true,
              }),
            );
        });
      }
    };
    const initialize = async () => {
      const callbackUrl = isCloudCallback(location.href) ? location.href : null;
      if (callbackUrl) await complete(callbackUrl);
      await cloudSession.start();
      if (!callbackUrl) resume();
    };
    queueMicrotask(
      () =>
        void initialize().catch((reason) => {
          setAuthorizationError(message(reason));
          choose("cloud");
        }),
    );
    const listener = appPlatform.addUrlOpenListener(
      (url) => void complete(url),
    );
    void appPlatform.launchUrl().then((url) => {
      if (url) void complete(url);
    });
    return () => {
      void listener.then((handle) => handle?.remove());
    };
  }, [choose, complete, runTransfer]);

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
      if (choice === "cloud" && currentCloudCollectionId() === collectionId) {
        setPickerOpen(false);
        return;
      }
      if (choice === "cloud") await disableMdbaseNotifications();
      cloudSession.select(collectionId, { history: "replace" });
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
    void cloudSession
      .authorize("choose")
      .catch((reason) => setAuthorizationError(message(reason)));
  }

  function reauthorizeCurrentCloudCollection() {
    clearPendingTransfer();
    setPickerOpen(false);
    choose("cloud");
    setAuthorizationError(null);
    void cloudSession
      .authorize("selected")
      .catch((reason) => setAuthorizationError(message(reason)));
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
      void cloudSession
        .authorize({ collectionId: pending.adoptedCollectionId })
        .catch((reason) =>
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
    cloudSession.select(migrationTarget.collectionId, { history: "replace" });
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

  if (!choice)
    return (
      <CollectionWelcome
        onChooseCloud={() => choose("cloud")}
        onChooseLocal={() => setChoosingLocalLocation(true)}
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
          cloudConnections={cloud.connections}
          migration={migration}
          rememberedExternal={readRememberedExternalCollection()}
          selectedCloudCollectionId={
            cloud.status === "ready" || cloud.status === "unavailable"
              ? cloud.collectionId
              : null
          }
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
  onChooseCloud,
  onChooseLocal,
}: {
  onChooseCloud(): void;
  onChooseLocal(): void;
}) {
  return (
    <main className="collection-welcome">
      <div className="welcome-copy">
        <img alt="" src={tasknotesMarkUrl} />
        <h1>Choose where your task collection lives.</h1>
        <p>
          TaskNotes saves changes on this device first. Hosted mdbase and
          device-only collections both keep working offline.
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
              <strong>Hosted mdbase</strong>
              <span className="recommendation-label">Sync + reminders</span>
            </span>
            <span className="collection-choice-benefits">
              <small>
                <Smartphone aria-hidden="true" size={15} />
                This device keeps a durable offline copy
              </small>
              <small>
                <Cloud aria-hidden="true" size={15} />
                The hosted collection is the source of truth and syncs changes
              </small>
              <small>
                <BellRing aria-hidden="true" size={15} />
                Reminders run while TaskNotes is closed
              </small>
            </span>
            <span className="collection-choice-action">Sync with mdbase</span>
          </span>
        </button>
        <button
          className="collection-choice"
          type="button"
          onClick={onChooseLocal}
        >
          <HardDrive aria-hidden="true" size={22} strokeWidth={1.5} />
          <span className="collection-choice-content">
            <strong>Keep on this device</strong>
            <span className="collection-choice-benefits">
              <small>
                <FileText aria-hidden="true" size={15} />
                Markdown files here are the source of truth
              </small>
              <small>
                <Smartphone aria-hidden="true" size={15} />
                Works offline with no sync or account required
              </small>
              <small>
                <BellOff aria-hidden="true" size={15} />
                Reminder details are saved; notifications are not delivered
              </small>
            </span>
            <span className="collection-choice-action">Use this device</span>
          </span>
        </button>
      </div>
      <p className="welcome-portability">
        <FileText aria-hidden="true" size={16} /> Both choices use portable
        Markdown. A direct computer connection is also available in mdbase
        setup, but requires that computer to be reachable. Changing collections
        later does not move tasks between them.
      </p>
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
        <h1>Use a folder for your tasks.</h1>
        <p>
          TaskNotes can use its usual folder or a compatible collection you
          already have.
        </p>
      </div>
      {error ? (
        <OperationErrorNotice
          action="The folder"
          message={error}
          recovery="Choose another folder or try again."
        />
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

function readChoice(canUseLocalCollection: boolean): CollectionChoice | null {
  const value = localStorage.getItem(STORAGE_KEY);
  if (value === "local" && (canUseLocalCollection || browserLocalE2e()))
    return value;
  if (!canUseLocalCollection) return "cloud";
  return value === "cloud" ? value : null;
}

function browserLocalE2e(): boolean {
  return import.meta.env.MODE === "e2e";
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

function currentCloudCollectionId(): string | null {
  const snapshot = cloudSession.getSnapshot();
  return snapshot.status === "ready" || snapshot.status === "unavailable"
    ? snapshot.collectionId
    : null;
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
