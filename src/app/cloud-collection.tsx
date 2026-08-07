import { useMemo, useState } from "react";
import { cloudSession } from "../cloud/connect";
import { requireConnectOutcome } from "../cloud/outcome";
import { TASKNOTES_REQUEST_BUDGETS } from "../cloud/request-budgets";
import { useCloudSessionSnapshot } from "../cloud/use-session";
import { createConnectTaskRepository } from "../storage/connect-repository";
import { tasknotesMarkUrl } from "./assets";
import { OpenedCollection } from "./opened-collection";

export default function CloudCollection({
  authorizationError,
  authorizeAnotherCollection,
  openCollectionPicker,
  reauthorizeCurrentCollection,
}: {
  authorizationError: string | null;
  authorizeAnotherCollection(): void;
  openCollectionPicker(): void;
  reauthorizeCurrentCollection(): void;
}) {
  const session = useCloudSessionSnapshot();
  const connection =
    session.status === "ready" ? cloudSession.connection() : null;
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

  if (!opened) return <CloudConnection error={authorizationError} />;

  return (
    <OpenedCollection
      authorizeAnotherCollection={authorizeAnotherCollection}
      changeCollection={openCollectionPicker}
      key={opened.collectionId}
      reauthorizeCurrentCollection={reauthorizeCurrentCollection}
      repository={opened.repository}
    />
  );
}

export function CloudConnection({ error }: { error: string | null }) {
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

  function open(collectionId: string) {
    setStartError(null);
    try {
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
        <p className="inline-error" role="alert">
          {error ?? startError}
        </p>
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
      <div className="welcome-actions">
        {connections
          .filter(
            (connection) =>
              session.status !== "setup_review_required" ||
              connection.collectionId !== selectedCollectionId,
          )
          .map((connection) => (
            <button
              key={connection.collectionId}
              className="outline-action"
              disabled={opening !== null}
              type="button"
              onClick={() => open(connection.collectionId)}
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
        {selectedCollectionId && session.status !== "setup_review_required" ? (
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

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
