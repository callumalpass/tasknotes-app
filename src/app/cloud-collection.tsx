import { BellRing, MonitorUp } from "lucide-react";
import { useMemo, useState } from "react";
import { unwrapConnectOutcome } from "@mdbase-dev/connect";

import { cloudSession } from "../cloud/connect";
import { useCloudSessionSnapshot } from "../cloud/use-session";
import { createConnectTaskRepository } from "../storage/connect-repository";
import { tasknotesMarkUrl } from "./assets";
import type { CollectionChoice } from "./collection-context";
import { OpenedCollection } from "./opened-collection";

export default function CloudCollection({
  authorizeAnotherCloudCollection,
  authorizationError,
  canChooseLocalFolder,
  changeLocalCollection,
  choose,
  openCollectionPicker,
  reauthorizeCurrentCloudCollection,
  reset,
}: {
  authorizeAnotherCloudCollection(): void;
  authorizationError: string | null;
  canChooseLocalFolder: boolean;
  changeLocalCollection(): void;
  choose(choice: CollectionChoice): void;
  openCollectionPicker(): void;
  reauthorizeCurrentCloudCollection(): void;
  reset(): void;
}) {
  const session = useCloudSessionSnapshot();
  const connection = session.status === "ready" ? session.connection : null;
  const opened = useMemo(
    () =>
      connection
        ? {
            collectionId: connection.collectionId,
            repository: createConnectTaskRepository(connection),
          }
        : null,
    [connection],
  );

  if (!opened)
    return (
      <CloudConnection
        error={authorizationError}
        onBack={canChooseLocalFolder ? reset : undefined}
      />
    );

  return (
    <OpenedCollection
      authorizeAnotherCloudCollection={authorizeAnotherCloudCollection}
      canChooseLocalFolder={canChooseLocalFolder}
      changeConnectedCollection={openCollectionPicker}
      changeLocalCollection={changeLocalCollection}
      choice="cloud"
      choose={choose}
      key={opened.collectionId}
      reauthorizeCurrentCloudCollection={reauthorizeCurrentCloudCollection}
      repository={opened.repository}
    />
  );
}

export function CloudConnection({
  error,
  onBack,
}: {
  error: string | null;
  onBack?: () => void;
}) {
  const [opening, setOpening] = useState<"another" | "reconnect" | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const session = useCloudSessionSnapshot();
  const connections = session.connections;
  const selectedCollectionId =
    session.status === "ready" || session.status === "unavailable"
      ? session.collectionId
      : null;
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

  return (
    <main className="collection-welcome cloud-welcome">
      <div className="welcome-copy">
        <img alt="" src={tasknotesMarkUrl} />
        <h1>Sync with mdbase.</h1>
        <p>
          Hosted mdbase is local-first: this device keeps an offline copy, then
          syncs changes to the shared source of truth.
        </p>
      </div>
      <div className="connection-comparison" aria-label="Connection options">
        <div>
          <BellRing aria-hidden="true" size={19} />
          <span>
            <strong>Hosted mdbase</strong>
            <small>
              Recommended. Works offline, syncs across devices, and delivers
              reminders while TaskNotes is closed.
            </small>
          </span>
        </div>
        <div>
          <MonitorUp aria-hidden="true" size={19} />
          <span>
            <strong>Connect to a computer</strong>
            <small>
              Connection required. Use a collection directly while that computer
              is reachable; it delivers task reminders.
            </small>
          </span>
        </div>
      </div>
      {error || startError ? (
        <p className="inline-error" role="alert">
          {error ?? startError}
        </p>
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
        {onBack ? (
          <button className="text-action" type="button" onClick={onBack}>
            Choose another location
          </button>
        ) : null}
      </div>
    </main>
  );
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
