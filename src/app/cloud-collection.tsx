import { useEffect, useMemo, useReducer, useState } from "react";
import { cloudSession, startCloudSession } from "../cloud/connect";
import { requireConnectOutcome } from "../cloud/outcome";
import { TASKNOTES_REQUEST_BUDGETS } from "../cloud/request-budgets";
import { useCloudSessionSnapshot } from "../cloud/use-session";
import {
  pendingRecoveryRequestIds,
  removePendingRecoveryCommands,
} from "../storage/application-journal";
import { createConnectTaskRepository } from "../storage/connect-repository";
import { tasknotesMarkUrl } from "./assets";
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
  const opened = useMemo(
    () =>
      connection && session.status === "ready"
        ? {
            collectionId: connection.collectionId,
            repository: createConnectTaskRepository(connection),
          }
        : null,
    [connection, session],
  );

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
        message={session.problem.message}
        onRetry={retryStartup}
      />
    );
  if (session.status === "destroyed")
    return (
      <ConnectionLifecycleProblem message="This TaskNotes connection has been closed." />
    );

  if (opened && recoveryLoadError)
    return (
      <ConnectionLifecycleProblem
        actionLabel="Retry recovery review"
        message={`TaskNotes could not inspect its saved recovery mappings: ${recoveryLoadError}`}
        onRetry={pendingMutationChanged}
      />
    );

  if (opened && pendingMutations.length > 0 && !mappedRequestIds)
    return <OpeningConnection />;

  if (opened && genericPendingMutations.length > 0)
    return (
      <PendingMutationReview
        count={genericPendingMutations.length}
        onDiscard={async () => {
          await removePendingRecoveryCommands(opened.collectionId);
          requireConnectOutcome(cloudSession.forget(opened.collectionId));
        }}
        onRecover={async () => {
          for (const pending of genericPendingMutations)
            requireConnectOutcome(
              await pending.recover({
                timeoutMs: TASKNOTES_REQUEST_BUDGETS.authorizationMs,
              }),
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
    <OpenedCollection
      authorizeAnotherCollection={authorizeAnotherCollection}
      changeCollection={openCollectionPicker}
      key={opened.collectionId}
      reauthorizeCurrentCollection={reauthorizeCurrentCollection}
      repository={opened.repository}
      discardPendingRecovery={async () => {
        await removePendingRecoveryCommands(opened.collectionId);
        requireConnectOutcome(cloudSession.forget(opened.collectionId));
      }}
    />
  );
}

function PendingMutationReview({
  count,
  onDiscard,
  onRecover,
}: {
  count: number;
  onDiscard(): Promise<void>;
  onRecover(): Promise<void>;
}) {
  const [confirming, setConfirming] = useState<"recover" | "discard" | null>(
    null,
  );
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function recover() {
    setWorking(true);
    setError(null);
    try {
      await onRecover();
    } catch (reason) {
      setError(message(reason));
      setConfirming(null);
    } finally {
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
          Recover checks each exact saved request. Discard removes the saved
          recovery, its grant keys, and disconnects this collection.
        </p>
      </div>
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
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
              onClick={() => setConfirming("recover")}
              type="button"
            >
              Recover saved changes
            </button>
            <button
              className="text-action"
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
}: {
  error: string | null;
  ensureStarted?(): Promise<void>;
  onTryDemo?(): void;
  retryAuthorization?(): void;
}) {
  const [opening, setOpening] = useState<"another" | "reconnect" | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const session = useCloudSessionSnapshot();
  const connections = session.connections;
  const selectedCollectionId =
    "collectionId" in session ? session.collectionId : null;
  const selectedConnection = connections.find(
    (connection) => connection.collectionId === selectedCollectionId,
  );

  async function connect(kind: "another" | "reconnect") {
    setOpening(kind);
    setStartError(null);
    try {
      await ensureStarted();
      requireConnectOutcome(
        await cloudSession.authorize(
          kind === "another" ? "choose" : "selected",
          { timeoutMs: TASKNOTES_REQUEST_BUDGETS.authorizationMs },
        ),
      );
    } catch (reason) {
      setStartError(message(reason));
    } finally {
      setOpening(null);
    }
  }

  async function open(collectionId: string) {
    setStartError(null);
    try {
      await ensureStarted();
      requireConnectOutcome(
        cloudSession.select(collectionId, { history: "replace" }),
      );
    } catch (reason) {
      setStartError(message(reason));
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

  return (
    <main className="collection-welcome cloud-welcome">
      <div className="welcome-copy">
        <img alt="" src={tasknotesMarkUrl} />
        <h1>Open TaskNotes</h1>
        <p>Continue in mdbase to choose a collection.</p>
      </div>
      {error || startError ? (
        <>
          <p className="inline-error" role="alert">
            {error ?? startError}
          </p>
          {error && retryAuthorization ? (
            <button
              className="outline-action"
              onClick={retryAuthorization}
              type="button"
            >
              Retry authorization
            </button>
          ) : null}
        </>
      ) : null}
      {session.status === "checking_setup" ? (
        <p className="connection-status" role="status">
          Checking this collection’s TaskNotes setup…
        </p>
      ) : null}
      {session.status === "blocked" ? (
        <p className="inline-error" role="alert">
          {session.problem.message}
        </p>
      ) : null}
      {session.status === "setup_review_required" ? (
        <section
          className="connection-update"
          aria-labelledby="collection-setup-title"
        >
          <h2 id="collection-setup-title">Review TaskNotes setup</h2>
          <p>
            TaskNotes needs the following collection settings and definitions.
            Your task records and unrelated collection settings will not change.
          </p>
          <ul>
            {session.update.configuration
              .filter((configuration) => configuration.action !== "current")
              .map((configuration) => (
                <li key={configuration.requirement}>
                  {configuration.action === "conflict"
                    ? configuration.conflict?.message
                    : `Allow TaskNotes Base views at ${String(configuration.value)}`}
                </li>
              ))}
            {session.update.typePacks.map((update) => (
              <li key={update.id}>
                {update.name}: {update.currentVersion ?? "not installed"} →{" "}
                {update.desiredVersion}
              </li>
            ))}
          </ul>
          <p>
            If you do not approve this setup, TaskNotes cannot create its
            portable views in this collection. You can choose another collection
            below.
          </p>
          <button
            className="outline-action"
            disabled={opening !== null || !session.update.canApply}
            onClick={() => void applyCollectionSetup()}
            type="button"
          >
            Apply reviewed setup
          </button>
        </section>
      ) : null}
      {session.status === "authorization_required" ? (
        <section
          className="connection-update"
          aria-labelledby="access-review-title"
        >
          <h2 id="access-review-title">Review updated access</h2>
          <p>
            TaskNotes needs you to review its updated collection access in
            mdbase before this collection can open.
          </p>
          <button
            className="outline-action"
            disabled={opening !== null}
            onClick={() => void connect("reconnect")}
            type="button"
          >
            {opening === "reconnect"
              ? "Opening mdbase…"
              : "Review updated access"}
          </button>
        </section>
      ) : null}
      <div className="welcome-actions">
        {onTryDemo ? (
          <button
            className="outline-action"
            disabled={opening !== null}
            onClick={onTryDemo}
            type="button"
          >
            Try demo
          </button>
        ) : null}
        {connections
          .filter(
            (connection) => connection.collectionId !== selectedCollectionId,
          )
          .map((connection) => (
            <button
              key={connection.collectionId}
              className="outline-action"
              disabled={opening !== null}
              type="button"
              onClick={() => void open(connection.collectionId)}
            >
              {session.status === "setup_review_required" ? "Use " : "Open "}
              {connection.displayName}
            </button>
          ))}
        <button
          className="outline-action"
          disabled={opening !== null}
          type="button"
          onClick={() => void connect("another")}
        >
          {opening === "another"
            ? "Opening mdbase…"
            : session.status === "setup_review_required"
              ? "Choose a different collection in mdbase"
              : connections.length
                ? "Connect another collection"
                : "Continue to mdbase"}
        </button>
        {selectedCollectionId &&
        session.status !== "setup_review_required" &&
        session.status !== "authorization_required" ? (
          <button
            className="text-action"
            disabled={opening !== null}
            type="button"
            onClick={() => void connect("reconnect")}
          >
            {opening === "reconnect"
              ? "Opening mdbase…"
              : `Reconnect ${selectedConnection?.displayName ?? "selected collection"}`}
          </button>
        ) : null}
      </div>
    </main>
  );
}

function OpeningConnection() {
  return (
    <main className="opening-screen">
      <p>Opening mdbase…</p>
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
          {message}
        </p>
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

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
