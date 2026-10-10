import type { MdbaseConnection, PendingMutation } from "@mdbase-dev/connect";
import type { AppWebSignInSnapshot } from "@mdbase-dev/sdk/app-host";
import { CloudConnectionView } from "./cloud-connection-view";
import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import {
  cloudSession,
  isHostedCloudConnection,
  startCloudSession,
} from "../cloud/connect";
import { requireConnectOutcome } from "../cloud/outcome";
import {
  recoverPendingChanges,
  type PendingRecoveryEntry,
} from "../cloud/pending-recovery";
import { TASKNOTES_REQUEST_BUDGETS } from "../cloud/request-budgets";
import { useCloudSessionSnapshot } from "../cloud/use-session";
import {
  pendingRecoveryRequestIds,
  removePendingRecoveryCommands,
} from "../storage/application-journal";
import { createConnectTaskRepository } from "../storage/connect-repository";
import { recoverMdbaseMutationHandle } from "../storage/mdbase-mutation-coordinator";
import { tasknotesMarkUrl } from "./assets";
import { collectionErrorMessage as message } from "./collection-error";
import { OpenedCollection } from "./opened-collection";

export default function CloudCollection({
  authorizationError,
  authorizeAnotherCollection,
  callbackRetryAvailable,
  openCollectionPicker,
  reauthorizeCurrentCollection,
  ensureStarted,
  retryStartup,
  onTryDemo,
}: {
  authorizationError: string | null;
  authorizeAnotherCollection(): void;
  callbackRetryAvailable: boolean;
  openCollectionPicker(): void;
  reauthorizeCurrentCollection(): void;
  ensureStarted(): Promise<void>;
  retryStartup(): void;
  onTryDemo?(): void;
}) {
  const session = useCloudSessionSnapshot();
  const [recoveryRevision, pendingMutationChanged] = useReducer(
    (value) => value + 1,
    0,
  );
  const connection =
    session.status === "ready" ? cloudSession.connection() : null;
  const [recovery, setRecovery] = useState<{
    collectionId: string;
    active: boolean;
    entries: PendingRecoveryEntry[];
  } | null>(null);
  const activeRecovery =
    recovery?.collectionId === connection?.collectionId &&
    recovery?.active === true;
  const pendingMutations = connection?.pendingMutations() ?? [];
  const pendingRequestKey = pendingMutations
    .map((pending) => pending.requestId)
    .join("\0");
  const [mappedRecovery, setMappedRecovery] = useState<{
    collectionId: string;
    error: string | null;
    pendingRequestKey: string;
    requestIds: Set<string>;
  } | null>(null);
  const collectionId = connection?.collectionId;
  useEffect(() => {
    if (!collectionId || !pendingRequestKey) return;
    let active = true;
    void pendingRecoveryRequestIds(collectionId).then(
      (requestIds) => {
        if (active)
          setMappedRecovery({
            collectionId,
            error: null,
            pendingRequestKey,
            requestIds,
          });
      },
      (reason) => {
        if (active)
          setMappedRecovery({
            collectionId,
            error: message(reason),
            pendingRequestKey,
            requestIds: new Set(),
          });
      },
    );
    return () => {
      active = false;
    };
  }, [collectionId, pendingRequestKey, recoveryRevision]);
  const recoveryLoadError =
    mappedRecovery &&
    mappedRecovery.collectionId === collectionId &&
    mappedRecovery.pendingRequestKey === pendingRequestKey
      ? mappedRecovery.error
      : null;
  const mappedRequestIds =
    mappedRecovery &&
    mappedRecovery.collectionId === collectionId &&
    mappedRecovery.pendingRequestKey === pendingRequestKey
      ? mappedRecovery.requestIds
      : null;
  const genericPendingMutations = mappedRequestIds
    ? pendingMutations.filter(
        (pending) => !mappedRequestIds.has(pending.requestId),
      )
    : [];
  const genericEntries: PendingRecoveryEntry[] = genericPendingMutations.map(
    (pending) => ({
      requestId: pending.requestId,
      operation: pending.operation,
      createdAt: pending.createdAt,
      status: "waiting",
      message: "Waiting to check the exact saved request.",
    }),
  );
  const opened = session.status === "ready" ? connection : null;

  if (session.status === "not_started" && authorizationError)
    return (
      <ConnectionLifecycleProblem
        actionLabel="Retry opening TaskNotes"
        message={authorizationError}
        onRetry={retryStartup}
      />
    );
  if (session.status === "not_started" || session.status === "starting")
    return <OpeningConnection />;
  if (session.status === "start_failed")
    return (
      <ConnectionLifecycleProblem
        actionLabel="Retry opening TaskNotes"
        message={message({ problem: session.problem })}
        onRetry={retryStartup}
      />
    );
  if (session.status === "destroyed")
    return (
      <ConnectionLifecycleProblem message="This TaskNotes connection has been closed." />
    );

  if (opened && recoveryLoadError && !activeRecovery)
    return (
      <ConnectionLifecycleProblem
        actionLabel="Retry recovery review"
        message={`TaskNotes could not inspect its saved recovery mappings: ${recoveryLoadError}`}
        onRetry={pendingMutationChanged}
      />
    );

  if (
    opened &&
    pendingMutations.length > 0 &&
    !mappedRequestIds &&
    !activeRecovery
  )
    return <OpeningConnection />;

  if (opened && (genericPendingMutations.length > 0 || activeRecovery))
    return (
      <PendingMutationReview
        connection={opened}
        count={
          activeRecovery
            ? recovery.entries.length
            : genericPendingMutations.length
        }
        recovering={activeRecovery}
        pending={genericPendingMutations}
        entries={
          recovery?.collectionId === opened.collectionId
            ? [
                ...recovery.entries,
                ...genericEntries.filter(
                  (p) =>
                    !recovery.entries.some((e) => e.requestId === p.requestId),
                ),
              ]
            : genericEntries
        }
        onDiscard={async () => {
          await removePendingRecoveryCommands(opened.collectionId);
          requireConnectOutcome(cloudSession.forget(opened.collectionId));
        }}
        onRecover={() => {
          setRecovery({
            collectionId: opened.collectionId,
            active: true,
            entries: genericEntries,
          });
        }}
        onProgress={(entry) =>
          setRecovery((current) =>
            current?.collectionId === opened.collectionId
              ? {
                  ...current,
                  entries: current.entries.map((item) =>
                    item.requestId === entry.requestId ? entry : item,
                  ),
                }
              : current,
          )
        }
        onRecoveryFinished={() => {
          setRecovery((current) =>
            current?.collectionId === opened.collectionId
              ? { ...current, active: false }
              : current,
          );
          pendingMutationChanged();
        }}
      />
    );

  if (!opened)
    return (
      <CloudConnection
        ensureStarted={ensureStarted}
        error={authorizationError}
        retryAuthorization={callbackRetryAvailable ? retryStartup : undefined}
        onTryDemo={onTryDemo}
      />
    );

  return (
    <ReadyCloudCollection
      connection={opened}
      session={session}
      authorizeAnotherCollection={authorizeAnotherCollection}
      changeCollection={openCollectionPicker}
      key={opened.collectionId}
      reauthorizeCurrentCollection={reauthorizeCurrentCollection}
      discardPendingRecovery={async () => {
        await removePendingRecoveryCommands(opened.collectionId);
        requireConnectOutcome(cloudSession.forget(opened.collectionId));
      }}
    />
  );
}

// Keep repository identity tied to both the SDK connection and application
// snapshot. The SDK may replace a connection without changing snapshot JSON.
function ReadyCloudCollection({
  connection,
  session,
  ...props
}: Omit<ComponentProps<typeof OpenedCollection>, "repository"> & {
  connection: MdbaseConnection;
  session: ReturnType<typeof useCloudSessionSnapshot>;
}) {
  const repository = useMemo(
    () =>
      session.status === "ready"
        ? createConnectTaskRepository(connection)
        : null,
    [connection, session],
  );
  return repository ? (
    <OpenedCollection {...props} repository={repository} />
  ) : null;
}

function PendingMutationReview({
  connection,
  count,
  entries,
  recovering,
  pending,
  onDiscard,
  onRecover,
  onProgress,
  onRecoveryFinished,
}: {
  connection: MdbaseConnection;
  count: number;
  entries: PendingRecoveryEntry[];
  recovering: boolean;
  pending: PendingMutation[];
  onDiscard(): Promise<void>;
  onRecover(): void;
  onProgress(entry: PendingRecoveryEntry): void;
  onRecoveryFinished(): void;
}) {
  const [confirming, setConfirming] = useState<"recover" | "discard" | null>(
    null,
  );
  const [workingLocally, setWorking] = useState(false);
  const working = workingLocally || recovering;
  const [error, setError] = useState<string | null>(null);

  async function recover() {
    if (working) return;
    setWorking(true);
    setError(null);
    try {
      onRecover();
      await recoverPendingChanges(
        pending,
        {
          timeoutMs: TASKNOTES_REQUEST_BUDGETS.authorizationMs,
        },
        onProgress,
        (handle, request) =>
          recoverMdbaseMutationHandle(connection, handle, request),
      );
      setConfirming(null);
    } catch (reason) {
      setError(message(reason));
      setConfirming(null);
    } finally {
      onRecoveryFinished();
      setWorking(false);
    }
  }

  async function discard() {
    setWorking(true);
    setError(null);
    try {
      await onDiscard();
    } catch (reason) {
      setError(message(reason));
      setConfirming(null);
    } finally {
      setWorking(false);
    }
  }

  return (
    <main className="collection-welcome cloud-welcome">
      <div className="welcome-copy">
        <img alt="" src={tasknotesMarkUrl} />
        <h1>Review unconfirmed changes</h1>
        <p>
          Mdbase retained {count} change{count === 1 ? "" : "s"} from an earlier
          session whose outcome could not be confirmed. TaskNotes will not
          replay {count === 1 ? "it" : "them"} automatically.
        </p>
        <p>
          Recover checks each exact saved request, even if another check fails.
          An earlier change may already have applied. Discard removes the saved
          recovery, its grant keys, and disconnects this collection; it cannot
          undo a change.
        </p>
      </div>
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
      <ul aria-label="Saved change recovery" aria-live="polite">
        {entries.map((entry) => (
          <li key={entry.requestId}>
            <strong>{entry.operation}</strong>{" "}
            <span>Request {entry.requestId.slice(0, 8)}</span>
            {" · "}
            <span>
              {Number.isNaN(Date.parse(entry.createdAt))
                ? "Unknown time"
                : new Date(entry.createdAt).toLocaleString()}
            </span>
            <p>{entry.message}</p>
          </li>
        ))}
      </ul>
      <div className="welcome-actions">
        {confirming === "recover" ? (
          <>
            <p>Recover all {count} saved changes now?</p>
            <button
              className="outline-action"
              disabled={working}
              onClick={() => void recover()}
              type="button"
            >
              {working ? "Recovering…" : "Confirm recovery"}
            </button>
            <button
              className="text-action"
              disabled={working}
              onClick={() => setConfirming(null)}
              type="button"
            >
              Keep saved recovery
            </button>
          </>
        ) : confirming === "discard" ? (
          <>
            <p>
              Discard all saved recovery and disconnect this collection? This
              does not reverse changes that may already have reached mdbase.
            </p>
            <button
              className="outline-action"
              disabled={working}
              onClick={() => void discard()}
              type="button"
            >
              {working ? "Discarding…" : "Confirm discard and disconnect"}
            </button>
            <button
              className="text-action"
              disabled={working}
              onClick={() => setConfirming(null)}
              type="button"
            >
              Keep saved recovery
            </button>
          </>
        ) : (
          <>
            <button
              className="outline-action"
              disabled={working}
              onClick={() => setConfirming("recover")}
              type="button"
            >
              Recover saved changes
            </button>
            <button
              className="text-action"
              disabled={working}
              onClick={() => setConfirming("discard")}
              type="button"
            >
              Discard recovery and disconnect
            </button>
          </>
        )}
      </div>
    </main>
  );
}

export function CloudConnection({
  error,
  ensureStarted = () =>
    startCloudSession({
      timeoutMs: TASKNOTES_REQUEST_BUDGETS.authorizationMs,
    }),
  onTryDemo,
  retryAuthorization,
  sdk,
}: {
  /** Actual public SDK snapshot/actions, never a fabricated legacy snapshot. */
  sdk?: {
    snapshot: AppWebSignInSnapshot;
    authorize(): Promise<void>;
    select(collectionId: string): Promise<void>;
  };
  error: string | null;
  ensureStarted?(): Promise<void>;
  onTryDemo?(): void;
  retryAuthorization?(): void;
}) {
  const [opening, setOpening] = useState<"another" | "reconnect" | null>(null);
  const [openingCollectionId, setOpeningCollectionId] = useState<string | null>(
    null,
  );
  const [authorizationPending, setAuthorizationPending] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const authorizationController = useRef<AbortController | null>(null);
  const legacySession = useCloudSessionSnapshot();
  const session = sdk?.snapshot ?? legacySession;
  const connections = sdk
    ? sdk.snapshot.collections
    : legacySession.connections;
  const selectedCollectionId = sdk
    ? sdk.snapshot.selectedCollectionId
    : "collectionId" in legacySession
      ? legacySession.collectionId
      : null;
  const selectedConnection = connections.find(
    (connection) => connection.collectionId === selectedCollectionId,
  );

  async function connect(kind: "another" | "reconnect") {
    const controller = new AbortController();
    authorizationController.current?.abort();
    authorizationController.current = controller;
    setAuthorizationPending(true);
    setOpening(kind);
    setStartError(null);
    try {
      if (sdk) {
        await sdk.authorize();
        return;
      }
      if (session.status === "not_started" || session.status === "starting") {
        await ensureStarted();
      }
      requireConnectOutcome(
        await cloudSession.authorize(
          kind === "another" ? "choose" : "selected",
          {
            presentation: "popup",
            signal: controller.signal,
            timeoutMs: TASKNOTES_REQUEST_BUDGETS.authorizationPopupMs,
          },
        ),
      );
    } catch (reason) {
      if (!controller.signal.aborted) setStartError(message(reason));
    } finally {
      if (authorizationController.current === controller) {
        authorizationController.current = null;
        setAuthorizationPending(false);
        setOpening(null);
      }
    }
  }

  function cancelAuthorization() {
    authorizationController.current?.abort(
      new DOMException("Authorization cancelled.", "AbortError"),
    );
    authorizationController.current = null;
    setAuthorizationPending(false);
    setOpening(null);
  }

  useEffect(
    () => () => {
      authorizationController.current?.abort(
        new DOMException("TaskNotes connection screen closed.", "AbortError"),
      );
    },
    [],
  );

  async function open(collectionId: string) {
    setOpeningCollectionId(collectionId);
    setStartError(null);
    try {
      if (sdk) {
        await sdk.select(collectionId);
        return;
      }
      await ensureStarted();
      requireConnectOutcome(
        cloudSession.select(collectionId, { history: "replace" }),
      );
    } catch (reason) {
      setStartError(message(reason));
    } finally {
      setOpeningCollectionId(null);
    }
  }

  async function applyCollectionSetup() {
    setOpening("reconnect");
    setStartError(null);
    try {
      await ensureStarted();
      requireConnectOutcome(
        await cloudSession.applyCollectionSetup({
          timeoutMs: TASKNOTES_REQUEST_BUDGETS.authorizationMs,
        }),
      );
    } catch (reason) {
      setStartError(message(reason));
    } finally {
      setOpening(null);
    }
  }

  const reviewingCollection =
    session.status === "setup_review_required" ||
    session.status === "authorization_required" ||
    session.status === "setup_required";
  const firstVisit = connections.length === 0 && !reviewingCollection;
  const sdkWaiting = sdk?.snapshot.status === "authorizing";
  const busy =
    opening !== null ||
    openingCollectionId !== null ||
    sdkWaiting ||
    sdk?.snapshot.status === "not_started" ||
    sdk?.snapshot.status === "starting" ||
    sdk?.snapshot.status === "opening";
  const availableConnections = connections.filter(
    (connection) => connection.collectionId !== selectedCollectionId,
  );

  return (
    <CloudConnectionView
      {...{
        session,
        sdk,
        error,
        startError,
        retryAuthorization,
        reviewingCollection,
        firstVisit,
        busy,
        sdkWaiting,
        authorizationPending,
        opening,
        openingCollectionId,
        selectedCollectionId,
        selectedConnection,
        availableConnections,
        connect,
        open,
        applyCollectionSetup,
        cancelAuthorization,
        onTryDemo,
      }}
      authorityFor={(id) => {
        const legacy = sdk
          ? undefined
          : legacySession.connections.find((item) => item.collectionId === id);
        return legacy ? isHostedCloudConnection(legacy) : null;
      }}
    />
  );
}

function OpeningConnection() {
  return (
    <main className="opening-screen">
      <p>Opening TaskNotes…</p>
    </main>
  );
}

function ConnectionLifecycleProblem({
  actionLabel,
  message,
  onRetry,
}: {
  actionLabel?: string;
  message: string;
  onRetry?(): void;
}) {
  return (
    <main className="collection-welcome cloud-welcome">
      <div className="welcome-copy">
        <img alt="" src={tasknotesMarkUrl} />
        <h1>Open TaskNotes</h1>
        <p className="inline-error" role="alert">
          {onRetry
            ? "TaskNotes couldn’t open right now. Please try again."
            : message}
        </p>
        {onRetry ? (
          <details className="connection-technical-details">
            <summary>Technical details</summary>
            <p>{message}</p>
          </details>
        ) : null}
      </div>
      {actionLabel && onRetry ? (
        <div className="welcome-actions">
          <button className="outline-action" onClick={onRetry} type="button">
            {actionLabel}
          </button>
        </div>
      ) : null}
    </main>
  );
}
