import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
} from "react";
import {
  describeError,
  summarizeStatus,
  type CollectionAvailability,
  type MdbaseErrorDescription,
  type MdbaseApplicationConnection,
  type MdbaseApplicationEntry,
} from "@mdbase-dev/sdk";
import { taskNotesApplicationEntry } from "../cloud/tasknotes-application";
import { NextTaskRepository } from "../storage/next-repository";
import { registerStartupTiming } from "../observability/startup-timing";
import { CloudConnectionView } from "./cloud-connection-view";
import { ApplicationProblemNotice } from "./application-problem-notice";
import { OpenedCollection } from "./opened-collection";
import {
  applicationProblemMessage,
  applicationRecoveryTarget,
} from "./application-problem";

export interface ApplicationPickerProps {
  connections: readonly {
    collectionId: string;
    displayName: string;
    availability?: CollectionAvailability;
  }[];
  selectedCollectionId: string | null;
  openingCollectionId?: string | null;
  busy?: boolean;
  error?: string | null;
  onRetry?(): void;
  onAuthorize(): void;
  onClose(): void;
  onSelect(collectionId: string): void;
}
interface HeldRepository {
  connection: MdbaseApplicationConnection;
  repository: NextTaskRepository;
}

/** SDK declaration/lifecycle only. No app Worker, URL controller, native setup
 * journal or popup factory. Every repository borrows the original SDK client. */
// Stable identity: the workspace must not restart when the gate re-renders.
async function preserveOriginalPending(): Promise<void> {
  throw new Error(
    "Original pending collection changes cannot be discarded here.",
  );
}

export function ApplicationCollectionGate({
  entry: supplied,
  Picker,
  Workspace = OpenedCollection,
}: {
  entry?: MdbaseApplicationEntry;
  Picker: ComponentType<ApplicationPickerProps>;
  Workspace?: ComponentType<Parameters<typeof OpenedCollection>[0]>;
}) {
  const [entry] = useState(() => supplied ?? taskNotesApplicationEntry());
  const [application] = useState(() => entry.application());
  const snapshot = useSyncExternalStore(
    application.subscribe,
    application.getSnapshot,
    application.getSnapshot,
  );
  const [held, setHeld] = useState<HeldRepository | null>(null);
  const repository = useRef<HeldRepository | null>(null);
  const [picking, setPicking] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const action = useRef(false);
  const lifetime = useRef({
    mounts: 0,
    started: false,
    owner: new AbortController(),
  });

  useEffect(() => {
    const original = lifetime.current;
    original.mounts++;
    const foreground = () => {
      try {
        application.setForeground(document.visibilityState !== "hidden");
      } catch (reason) {
        setError(reason);
      }
    };
    foreground();
    document.addEventListener("visibilitychange", foreground);
    if (!original.started) {
      original.started = true;
      void application
        .start({ signal: original.owner.signal })
        .catch((reason: unknown) => {
          if (!original.owner.signal.aborted) setError(reason);
        });
    }
    return () => {
      document.removeEventListener("visibilitychange", foreground);
      original.mounts--;
      // React effect replay retains ONE entry and original initialization.
      queueMicrotask(() => {
        if (original.mounts) return;
        original.owner.abort();
        repository.current?.repository.dispose();
        repository.current = null;
        // Physical Worker/SQL/lease drain and failed-stop quarantine stay SDK-owned.
        void application.close().catch(() => {
          /* The terminal original owner stays quarantined; no replacement. */
        });
      });
    };
  }, [application]);

  const usable = snapshot.selection.usable;
  const connection = usable ? entry.connection(usable.collectionId) : null;
  const ready =
    snapshot.selection.state === "usable" &&
    snapshot.status === "ready" &&
    (!snapshot.problem ||
      ["collection_migrating", "update_required", "account_suspended"].includes(
        snapshot.problem,
      )) &&
    !snapshot.selection.problem &&
    !snapshot.readiness.checking &&
    !snapshot.readiness.problem &&
    snapshot.readiness.assessment?.status === "ready";
  useEffect(() => {
    const old = repository.current;
    if (
      old &&
      (!connection ||
        !old.connection.isCurrent() ||
        old.connection.generation !== connection.generation ||
        old.connection.records !== connection.records)
    ) {
      old.repository.dispose();
      repository.current = null;
      setHeld(null);
    }
    if (!ready || !connection?.isCurrent() || repository.current) return;
    const next = {
      connection,
      repository: new NextTaskRepository(
        connection.records,
        connection.displayName,
        connection.scope.account,
        { clientOwnership: "borrowed", peopleClient: connection.people },
      ),
    };
    // Only app-owned stages: no invented native/Worker durations or extra reads.
    registerStartupTiming(next.repository);
    repository.current = next;
    setHeld(next);
  }, [connection, ready]);

  async function run(operation: () => Promise<unknown>) {
    if (action.current || lifetime.current.owner.signal.aborted) return;
    action.current = true;
    setWorking(true);
    setError(null);
    try {
      // Executes synchronously in the user gesture: SDK reserves its own popup
      // BEFORE its first await. This is a presentation latch, not a native FIFO.
      await operation();
    } catch (reason) {
      if (!lifetime.current.owner.signal.aborted) setError(reason);
    } finally {
      action.current = false;
      if (!lifetime.current.owner.signal.aborted) setWorking(false);
    }
  }
  const options = () => ({ signal: lifetime.current.owner.signal });
  const select = (id: string) =>
    run(async () => {
      await application.select(id, options());
      if (application.getSnapshot().selection.usable?.collectionId === id)
        setPicking(false);
    });
  const recovery = applicationRecoveryTarget(snapshot);
  const busy =
    working ||
    snapshot.readiness.checking ||
    ["starting", "authorizing", "opening"].includes(snapshot.status) ||
    ["opening", "approving"].includes(snapshot.selection.state);
  const repeatableSignIn =
    snapshot.status === "authorizing" && snapshot.signIn?.state !== "paired";
  const problem =
    error ??
    (snapshot.problem
      ? snapshot
      : (snapshot.selection.problem ?? snapshot.readiness));
  const description = describeError(problem);
  const message =
    description || error || snapshot.selection.problem
      ? applicationProblemMessage(problem)
      : null;
  const developerMessage = description?.developerMessage;
  useEffect(() => {
    // The SDK derives this solely from typed registration codes/manifest paths.
    // Never log the original error, server body, identifiers or credentials.
    if (developerMessage) console.warn("[TaskNotes]", developerMessage);
  }, [developerMessage]);
  // A collection change makes the SDK re-check readiness. Re-checking is not a
  // verdict: keep the open workspace (its in-flight reads, writes and drafts)
  // until readiness settles. Only a settled non-ready result closes it.
  const rechecking =
    snapshot.selection.state === "usable" &&
    !snapshot.selection.problem &&
    !snapshot.problem &&
    ["opening", "ready"].includes(snapshot.status) &&
    !snapshot.readiness.problem &&
    (snapshot.readiness.checking || snapshot.readiness.assessment === null);
  const current =
    held &&
    held.connection.isCurrent() &&
    connection?.generation === held.connection.generation &&
    connection.records === held.connection.records &&
    (ready || rechecking)
      ? held
      : null;
  const request = snapshot.selection.requested;
  const chooseAnother = () =>
    void run(() => application.chooseAnother(options()));
  const approve = async () => {
    if (!repeatableSignIn)
      return run(() => application.approve(undefined, options()));
    // Each retry is an explicit gesture on the SAME SDK owner. The SDK alone
    // reserves the popup and decides renewal versus original-request recovery.
    setError(null);
    try {
      await application.approve(undefined, options());
    } catch (reason) {
      if (!lifetime.current.owner.signal.aborted) setError(reason);
    }
  };
  const authorizeAnother = () =>
    void run(() => application.approve(null, options()));
  const setup = snapshot.readiness.assessment?.status === "setup_required";
  const requireCurrentScope = (expected: string | undefined) => {
    if (
      !expected ||
      !entry.connection(expected)?.isCurrent() ||
      application.getSnapshot().selection.usable?.collectionId !== expected
    )
      throw Object.assign(new Error("Collection scope is no longer current."), {
        code: "application_selection_fenced",
      });
  };
  const configure = () =>
    run(() => {
      requireCurrentScope(usable?.collectionId);
      return application.configure(options());
    });

  return (
    <>
      {current && error != null && !picking ? (
        description ? (
          <ApplicationProblemNotice
            alert
            description={description}
            message={message ?? undefined}
          />
        ) : (
          <p className="connection-error" role="alert">
            {message}
          </p>
        )
      ) : null}
      {current && snapshot.problem && description && error == null ? (
        <LiveCollectionProblem
          connection={current.connection}
          problem={snapshot.problem}
          description={description}
        />
      ) : null}
      {current ? (
        <Workspace
          key={current.connection.generation}
          repository={current.repository}
          changeCollection={() => setPicking(true)}
          authorizeAnotherCollection={authorizeAnother}
          reauthorizeCurrentCollection={() =>
            void run(() => {
              requireCurrentScope(current.connection.id);
              return application.reauthorize(options());
            })
          }
          discardPendingRecovery={preserveOriginalPending}
        />
      ) : (
        <CloudConnectionView
          session={snapshot}
          sdk={{ snapshot }}
          problemDescription={description}
          error={
            error != null
              ? message
              : recovery && snapshot.problem === "outcome_unknown"
                ? "Opening this collection could not be confirmed. Keep this browser's stored data and retry to check the original request."
                : message
          }
          startError={null}
          retryCollection={recovery ? () => void select(recovery) : undefined}
          reviewingCollection={setup}
          firstVisit={
            snapshot.signIn?.state !== "paired" &&
            snapshot.collections.length === 0
          }
          busy={busy}
          connectBusy={repeatableSignIn ? false : busy}
          sdkWaiting={
            snapshot.status === "authorizing" ||
            snapshot.selection.state === "approving"
          }
          authorizationPending={
            working && snapshot.selection.state === "approving"
          }
          opening={
            working && snapshot.selection.state === "approving"
              ? "another"
              : null
          }
          openingCollectionId={
            snapshot.selection.state === "opening" ? request.collectionId : null
          }
          selectedCollectionId={usable?.collectionId ?? null}
          selectedConnection={usable ?? undefined}
          availableConnections={snapshot.collections.filter(
            (item) => item.collectionId !== usable?.collectionId,
          )}
          connect={() => approve()}
          connectLabel={
            snapshot.selection.state === "approval_required"
              ? "Approve requested collection"
              : undefined
          }
          open={select}
          configureCollection={setup ? () => void configure() : undefined}
          chooseAnotherCollection={
            request.collectionId || snapshot.selection.state === "invalid"
              ? chooseAnother
              : undefined
          }
          applyCollectionSetup={configure}
          cancelAuthorization={() => {}}
        />
      )}
      {picking ? (
        <Picker
          connections={snapshot.collections}
          selectedCollectionId={usable?.collectionId ?? null}
          openingCollectionId={
            snapshot.selection.state === "opening" ? request.collectionId : null
          }
          busy={busy}
          error={message}
          onRetry={recovery ? () => void select(recovery) : undefined}
          onAuthorize={authorizeAnother}
          onClose={() => setPicking(false)}
          onSelect={(id) => void select(id)}
        />
      ) : null}
    </>
  );
}

function LiveCollectionProblem({
  connection,
  problem,
  description,
}: {
  connection: MdbaseApplicationConnection;
  problem: string;
  description: MdbaseErrorDescription;
}) {
  const records = connection.records;
  const [status, setStatus] = useState(() => records.status);
  useEffect(() => records.onStatus(setStatus), [records]);
  const summary = summarizeStatus(status, problem);
  return (
    <ApplicationProblemNotice
      description={description}
      summary={summary.text}
    />
  );
}
