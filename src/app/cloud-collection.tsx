import { BellRing, MonitorUp } from "lucide-react";
import { useMemo, useState } from "react";
import { unwrapConnectOutcome } from "@mdbase-dev/connect";

import { cloudSession } from "../cloud/connect";
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
      unwrapConnectOutcome(
        await cloudSession.authorize(
          kind === "another" ? "choose" : "selected",
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
      unwrapConnectOutcome(
        cloudSession.select(collectionId, { history: "replace" }),
      );
    } catch (reason) {
      setStartError(message(reason));
    }
  }

  async function applyDefinitionUpdates() {
    setOpening("reconnect");
    setStartError(null);
    try {
      unwrapConnectOutcome(await cloudSession.applyDefinitionUpdates());
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
        <h1>Open TaskNotes with mdbase.</h1>
        <p>
          Choose where your Markdown collection lives. TaskNotes reads and
          writes it directly through mdbase.
        </p>
      </div>
      <div className="connection-comparison" aria-label="Connection options">
        <div>
          <BellRing aria-hidden="true" size={19} />
          <span>
            <strong>Hosted mdbase</strong>
            <small>
              Recommended. Available anywhere with a connection and able to
              deliver reminders while TaskNotes is closed.
            </small>
          </span>
        </div>
        <div>
          <MonitorUp aria-hidden="true" size={19} />
          <span>
            <strong>Connect to a computer</strong>
            <small>
              Keep the collection on your computer and use it while that
              computer is reachable.
            </small>
          </span>
        </div>
      </div>
      {error || startError ? (
        <p className="inline-error" role="alert">
          {error ?? startError}
        </p>
      ) : null}
      {session.status === "checking_definitions" ? (
        <p className="connection-status" role="status">
          Checking this collection’s TaskNotes definitions…
        </p>
      ) : null}
      {session.status === "blocked" ? (
        <p className="inline-error" role="alert">
          {session.problem.message}
        </p>
      ) : null}
      {session.status === "definition_review_required" ? (
        <section
          className="connection-update"
          aria-labelledby="definition-update-title"
        >
          <h2 id="definition-update-title">Task definitions changed</h2>
          <p>
            Review the source-of-truth changes before updating this collection.
            No task records change until you continue.
          </p>
          <ul>
            {session.updates.map((update) => (
              <li key={update.id}>
                {update.name}: {update.currentVersion ?? "not installed"} →{" "}
                {update.desiredVersion}
              </li>
            ))}
          </ul>
          <button
            className="outline-action"
            disabled={
              opening !== null ||
              session.updates.some((update) => !update.canApply)
            }
            onClick={() => void applyDefinitionUpdates()}
            type="button"
          >
            Review and update definitions
          </button>
        </section>
      ) : null}
      <div className="welcome-actions">
        {connections.map((connection) => (
          <button
            key={connection.collectionId}
            className="outline-action"
            disabled={opening !== null}
            type="button"
            onClick={() => open(connection.collectionId)}
          >
            Open {connection.displayName}
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
            : connections.length
              ? "Connect another collection"
              : "Continue to mdbase"}
        </button>
        {selectedCollectionId ? (
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
