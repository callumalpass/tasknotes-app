import { appLocale } from "../i18n/app";
import { useLingui, Trans, Plural } from "@lingui/react/macro";
import type { MdbaseConnection, PendingMutation } from "@mdbase-dev/connect";
import { ArrowRight, ChevronDown, Cloud, Monitor, Plus } from "lucide-react";
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
  const { t } = useLingui();
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
      message: t({ message: "Waiting to check the exact saved request." }),
    }),
  );
  const opened = session.status === "ready" ? connection : null;

  if (session.status === "not_started" && authorizationError)
    return (
      <ConnectionLifecycleProblem
        actionLabel={t({ message: "Retry opening TaskNotes" })}
        message={authorizationError}
        onRetry={retryStartup}
      />
    );
  if (session.status === "not_started" || session.status === "starting")
    return <OpeningConnection />;
  if (session.status === "start_failed")
    return (
      <ConnectionLifecycleProblem
        actionLabel={t({ message: "Retry opening TaskNotes" })}
        message={session.problem.message}
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
        actionLabel={t({ message: "Retry recovery review" })}
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
  const { t } = useLingui();
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
        <h1>
          <Trans>Review unconfirmed changes</Trans>
        </h1>
        <p>
          <Plural
            value={count}
            one="Mdbase retained # change from an earlier session whose outcome could not be confirmed. TaskNotes will not replay it automatically."
            other="Mdbase retained # changes from an earlier session whose outcome could not be confirmed. TaskNotes will not replay them automatically."
          />
        </p>
        <p>
          <Trans>
            Recover checks each exact saved request, even if another check
            fails. An earlier change may already have applied. Discard removes
            the saved recovery, its grant keys, and disconnects this collection;
            it cannot undo a change.
          </Trans>
        </p>
      </div>
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
      <ul
        aria-label={t({ message: "Saved change recovery" })}
        aria-live="polite"
      >
        {entries.map((entry) => (
          <li key={entry.requestId}>
            <strong>{entry.operation}</strong>{" "}
            <span>
              <Trans>Request {entry.requestId.slice(0, 8)}</Trans>
            </span>
            {" · "}
            <span>
              {Number.isNaN(Date.parse(entry.createdAt))
                ? t({ message: "Unknown time" })
                : new Date(entry.createdAt).toLocaleString(appLocale())}
            </span>
            <p>{entry.message}</p>
          </li>
        ))}
      </ul>
      <div className="welcome-actions">
        {confirming === "recover" ? (
          <>
            <p>
              <Trans>Recover all {count} saved changes now?</Trans>
            </p>
            <button
              className="outline-action"
              disabled={working}
              onClick={() => void recover()}
              type="button"
            >
              {working
                ? t({ message: "Recovering…" })
                : t({ message: "Confirm recovery" })}
            </button>
            <button
              className="text-action"
              disabled={working}
              onClick={() => setConfirming(null)}
              type="button"
            >
              <Trans>Keep saved recovery</Trans>
            </button>
          </>
        ) : confirming === "discard" ? (
          <>
            <p>
              <Trans>
                Discard all saved recovery and disconnect this collection? This
                does not reverse changes that may already have reached mdbase.
              </Trans>
            </p>
            <button
              className="outline-action"
              disabled={working}
              onClick={() => void discard()}
              type="button"
            >
              {working
                ? t({ message: "Discarding…" })
                : t({ message: "Confirm discard and disconnect" })}
            </button>
            <button
              className="text-action"
              disabled={working}
              onClick={() => setConfirming(null)}
              type="button"
            >
              <Trans>Keep saved recovery</Trans>
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
              <Trans>Recover saved changes</Trans>
            </button>
            <button
              className="text-action"
              disabled={working}
              onClick={() => setConfirming("discard")}
              type="button"
            >
              <Trans>Discard recovery and disconnect</Trans>
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
  const { t } = useLingui();
  const [opening, setOpening] = useState<"another" | "reconnect" | null>(null);
  const [openingCollectionId, setOpeningCollectionId] = useState<string | null>(
    null,
  );
  const [authorizationPending, setAuthorizationPending] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const authorizationController = useRef<AbortController | null>(null);
  const session = useCloudSessionSnapshot();
  const connections = session.connections;
  const selectedCollectionId =
    "collectionId" in session ? session.collectionId : null;
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
    session.status === "authorization_required";
  const firstVisit = connections.length === 0 && !reviewingCollection;
  const busy = opening !== null || openingCollectionId !== null;
  const availableConnections = connections.filter(
    (connection) => connection.collectionId !== selectedCollectionId,
  );

  return (
    <main className="collection-welcome cloud-welcome">
      <div className="welcome-copy">
        <img alt="" src={tasknotesMarkUrl} />
        <h1>
          {reviewingCollection
            ? t({ message: "Finish opening TaskNotes" })
            : firstVisit
              ? t({ message: "Connect TaskNotes to your tasks" })
              : t({ message: "Welcome back" })}
        </h1>
        <p>
          {reviewingCollection
            ? t({
                message:
                  "Complete this collection’s setup, or choose a different collection.",
              })
            : firstVisit
              ? t({
                  message:
                    "TaskNotes works with collections managed by mdbase.",
                })
              : t({ message: "Choose a collection to open your tasks." })}
        </p>
        <details className="mdbase-explainer">
          <summary>
            <span>
              <Trans>What is mdbase?</Trans>
            </span>
            <ChevronDown aria-hidden="true" size={16} />
          </summary>
          <p>
            <Trans>
              mdbase keeps your tasks as portable Markdown files while giving
              compatible apps a shared way to understand them. mdbase Connect
              lets you choose a collection and approve TaskNotes’ access—whether
              it’s hosted by mdbase or available from a connected computer.
            </Trans>
          </p>
        </details>
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
              <Trans>Retry authorization</Trans>
            </button>
          ) : null}
        </>
      ) : null}
      {session.status === "checking_setup" ? (
        <p className="connection-status" role="status">
          <Trans>Checking this collection’s TaskNotes setup…</Trans>
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
          <h2 id="collection-setup-title">
            <Trans>Review TaskNotes setup</Trans>
          </h2>
          <p>
            <Trans>
              TaskNotes needs the following collection settings and definitions.
              Your task records and unrelated collection settings will not
              change.
            </Trans>
          </p>
          <ul>
            {session.update.configuration
              .filter((configuration) => configuration.action !== "current")
              .map((configuration) => (
                <li key={configuration.requirement}>
                  {configuration.action === "conflict"
                    ? configuration.conflict?.message
                    : t`Allow TaskNotes Base views at ${String(configuration.value)}`}
                </li>
              ))}
            {session.update.typePacks.map((update) => (
              <li key={update.id}>
                {update.name}:{" "}
                {update.currentVersion ?? t({ message: "not installed" })} →{" "}
                {update.desiredVersion}
              </li>
            ))}
          </ul>
          <p>
            <Trans>
              If you do not approve this setup, TaskNotes cannot create its
              portable views in this collection. You can choose another
              collection below.
            </Trans>
          </p>
          <button
            className="outline-action"
            disabled={opening !== null || !session.update.canApply}
            onClick={() => void applyCollectionSetup()}
            type="button"
          >
            <Trans>Apply reviewed setup</Trans>
          </button>
        </section>
      ) : null}
      {session.status === "authorization_required" ? (
        <section
          className="connection-update"
          aria-labelledby="access-review-title"
        >
          <h2 id="access-review-title">
            <Trans>Review updated access</Trans>
          </h2>
          <p>
            <Trans>
              TaskNotes needs you to review its updated collection access in
              mdbase before this collection can open.
            </Trans>
          </p>
          <button
            className="outline-action"
            disabled={opening !== null}
            onClick={() => void connect("reconnect")}
            type="button"
          >
            {opening === "reconnect"
              ? t({ message: "Opening mdbase…" })
              : t({ message: "Review updated access" })}
          </button>
        </section>
      ) : null}
      <div className="welcome-actions">
        {availableConnections.length ? (
          <section
            aria-labelledby="recent-collections-title"
            className="welcome-collections"
          >
            <h2 id="recent-collections-title">
              {reviewingCollection
                ? t({ message: "Other collections" })
                : t({ message: "Recent collections" })}
            </h2>
            <div className="welcome-collection-list">
              {availableConnections.map((connection) => {
                const hosted = isHostedCloudConnection(connection);
                const authorityLabel = hosted
                  ? t({ message: "Hosted by mdbase" })
                  : t({ message: "Connected computer" });
                const action =
                  session.status === "setup_review_required"
                    ? t({ message: "Use" })
                    : t({ message: "Open" });
                return (
                  <button
                    aria-label={`${action} ${connection.displayName}, ${authorityLabel}`}
                    className="welcome-collection-row"
                    disabled={busy}
                    key={connection.collectionId}
                    onClick={() => void open(connection.collectionId)}
                    type="button"
                  >
                    <span className="welcome-collection-icon">
                      {hosted ? (
                        <Cloud aria-hidden="true" size={19} />
                      ) : (
                        <Monitor aria-hidden="true" size={19} />
                      )}
                    </span>
                    <span className="welcome-collection-copy">
                      <strong>{connection.displayName}</strong>
                      <small>{authorityLabel}</small>
                    </span>
                    <span className="welcome-collection-open">
                      {openingCollectionId === connection.collectionId ? (
                        t({ message: "Opening…" })
                      ) : (
                        <ArrowRight aria-hidden="true" size={18} />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}
        <div className="welcome-connect-action">
          <button
            className={
              firstVisit
                ? "welcome-primary-action"
                : "outline-action welcome-secondary-action"
            }
            disabled={busy}
            type="button"
            onClick={() => void connect("another")}
          >
            {opening === "another" ? (
              <span className="welcome-opening-label">
                <Trans>Opening mdbase…</Trans>
              </span>
            ) : (
              <>
                <Plus aria-hidden="true" size={18} />
                <span>
                  {reviewingCollection
                    ? t({ message: "Choose a different collection in mdbase" })
                    : firstVisit
                      ? t({ message: "Choose a collection" })
                      : t({ message: "Choose another collection in mdbase" })}
                </span>
                <ArrowRight aria-hidden="true" size={18} />
              </>
            )}
          </button>
          <p role={authorizationPending ? "status" : undefined}>
            {authorizationPending
              ? t({ message: "Complete your selection in the mdbase window." })
              : t({
                  message:
                    "mdbase will open so you can choose a collection and approve access.",
                })}
          </p>
        </div>
        {selectedCollectionId &&
        session.status !== "setup_review_required" &&
        session.status !== "authorization_required" ? (
          <button
            className="text-action"
            disabled={busy}
            type="button"
            onClick={() => void connect("reconnect")}
          >
            {opening === "reconnect"
              ? t({ message: "Opening mdbase…" })
              : t`Reconnect ${selectedConnection?.displayName ?? t({ message: "selected collection" })}`}
          </button>
        ) : null}
        {authorizationPending ? (
          <button
            className="welcome-cancel-action"
            onClick={cancelAuthorization}
            type="button"
          >
            <Trans>Cancel</Trans>
          </button>
        ) : null}
        {onTryDemo ? (
          <button
            className="welcome-demo-action"
            disabled={busy}
            onClick={onTryDemo}
            type="button"
          >
            <Trans>Try a disposable demo</Trans>
          </button>
        ) : null}
      </div>
    </main>
  );
}

function OpeningConnection() {
  return (
    <main className="opening-screen">
      <p>
        <Trans>Opening TaskNotes…</Trans>
      </p>
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
  const { t } = useLingui();
  return (
    <main className="collection-welcome cloud-welcome">
      <div className="welcome-copy">
        <img alt="" src={tasknotesMarkUrl} />
        <h1>
          <Trans>Open TaskNotes</Trans>
        </h1>
        <p className="inline-error" role="alert">
          {onRetry
            ? t({
                message: "TaskNotes couldn’t open right now. Please try again.",
              })
            : message}
        </p>
        {onRetry ? (
          <details className="connection-technical-details">
            <summary>
              <Trans>Technical details</Trans>
            </summary>
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

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
