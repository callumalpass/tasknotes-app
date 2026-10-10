import { useEffect, useRef, useState } from "react";
import type { AppWebSignInSnapshot } from "@mdbase-dev/sdk/app-host";
import type { TaskRepository } from "../application/ports/task-repository";
import type { NextInstallationBuildInput } from "../cloud/next-installation-protocol";
import { NextInstallationWorker } from "../cloud/next-installation-worker";
import { openConnectPopup } from "../cloud/connect-popup";
import { CloudConnectionView } from "./cloud-connection-view";

function signInMessage(reason: unknown): string {
  if (reason instanceof Error && reason.message.includes("popup_blocked"))
    return "Your browser blocked the sign-in window.";
  return "Sign-in was interrupted. Please try again.";
}
/** Existing production welcome renderer, driven by the actual SDK session.
 * Keep this owner mounted when its single repository is handed to the gate.
 * Approval polling, original request/device and collection selection are SDK
 * owned; UI neither exchanges receipts nor manually confirms an account.
 */
export function CloudSignIn({
  build,
  onCollection,
}: {
  build: NextInstallationBuildInput;
  onCollection(repository: TaskRepository): Promise<void>;
}) {
  const [snapshot, setSnapshot] = useState<AppWebSignInSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const action = useRef(false);
  const owner = useRef<NextInstallationWorker | null>(null);
  const current = useRef<AbortSignal | null>(null);
  const onCollectionRef = useRef(onCollection);
  useEffect(() => {
    onCollectionRef.current = onCollection;
  }, [onCollection]);
  useEffect(() => {
    const lifetime = new AbortController();
    current.current = lifetime.signal;
    let held: NextInstallationWorker | null = null,
      stop: (() => void) | null = null;
    let claiming = false,
      delivered = false;
    const publish = () => {
      if (lifetime.signal.aborted || !held || owner.current !== held) return;
      const value = held.getSnapshot();
      setSnapshot(value);
      if (value?.problem) setError(signInMessage(value.problem));
      else setError(null);
      if (
        !claiming &&
        !delivered &&
        value?.selectedCollectionId &&
        (value.status === "setup_required" || value.status === "ready")
      ) {
        claiming = true;
        const original = held,
          collectionId = value.selectedCollectionId;
        void original
          .openCollection(collectionId)
          .then(async (repository) => {
            if (lifetime.signal.aborted || owner.current !== original) return;
            if (original.getSnapshot()?.selectedCollectionId !== collectionId)
              throw Error("Original collection changed.");
            await onCollectionRef.current(repository);
            delivered = true;
          })
          .catch((reason) => {
            if (!lifetime.signal.aborted) setError(signInMessage(reason));
          });
      }
    };
    void NextInstallationWorker.openSession(build, lifetime.signal)
      .then(async (worker) => {
        held = worker;
        if (lifetime.signal.aborted) {
          await worker.close();
          return;
        }
        owner.current = worker;
        stop = worker.subscribe(publish);
        publish();
        await worker.startSession();
      })
      .catch((reason) => {
        if (!lifetime.signal.aborted) setError(signInMessage(reason));
      });
    return () => {
      lifetime.abort();
      stop?.();
      if (owner.current === held) owner.current = null;
      void held?.close().catch(() => {
        /* Original failed-stop owner remains quarantined. */
      });
    };
  }, [build]);
  async function authorize() {
    const original = owner.current,
      signal = current.current;
    if (!original || !signal || signal.aborted)
      throw Error("Sign-in was interrupted. Please try again.");
    // Reserve the production popup BEFORE any await or Worker message.
    try {
      original.reservePortal(openConnectPopup);
    } catch {
      throw Error("Your browser blocked the sign-in window.");
    }
    try {
      if (original.getSnapshot()?.problem === "expired")
        await original.renewSession();
      signal.throwIfAborted();
      await original.authorizeSession();
      signal.throwIfAborted();
    } catch (reason) {
      original.closePortal();
      throw Error(signInMessage(reason), { cause: reason });
    }
  }
  if (!snapshot) {
    return (
      <main className="opening-screen">
        <p role="status">Opening TaskNotes…</p>
        {error ? (
          <p className="inline-error" role="alert">
            {error}
          </p>
        ) : null}
      </main>
    );
  }
  const run = async (operation: () => Promise<unknown>) => {
    if (action.current) return;
    action.current = true;
    setWorking(true);
    setError(null);
    try {
      await operation();
    } catch (reason) {
      if (!current.current?.aborted)
        setError(
          reason instanceof Error ? reason.message : signInMessage(reason),
        );
    } finally {
      action.current = false;
      if (!current.current?.aborted) setWorking(false);
    }
  };
  const selectedCollectionId = snapshot.selectedCollectionId;
  return (
    <CloudConnectionView
      session={snapshot}
      sdk={{ snapshot }}
      error={error}
      startError={null}
      reviewingCollection={snapshot.status === "setup_required"}
      firstVisit={
        snapshot.collections.length === 0 &&
        snapshot.status !== "setup_required"
      }
      busy={
        working ||
        ["not_started", "starting", "authorizing", "opening"].includes(
          snapshot.status,
        )
      }
      sdkWaiting={snapshot.status === "authorizing"}
      authorizationPending={working}
      opening={working ? "another" : null}
      openingCollectionId={null}
      selectedCollectionId={selectedCollectionId}
      selectedConnection={snapshot.collections.find(
        (item) => item.collectionId === selectedCollectionId,
      )}
      availableConnections={snapshot.collections.filter(
        (item) => item.collectionId !== selectedCollectionId,
      )}
      connect={() => run(authorize)}
      open={(collectionId) =>
        run(async () => {
          const original = owner.current;
          if (!original || current.current?.aborted)
            throw Error("Sign-in was interrupted. Please try again.");
          try {
            await original.selectSession(collectionId);
          } catch (reason) {
            throw Error(signInMessage(reason), { cause: reason });
          }
        })
      }
      applyCollectionSetup={async () => {
        throw Error("Setup review is unavailable in this sign-in view.");
      }}
      cancelAuthorization={() => {
        /* No invented SDK cancellation UI. */
      }}
    />
  );
}
