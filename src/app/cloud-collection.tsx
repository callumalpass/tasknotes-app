import { BellRing, MonitorUp } from "lucide-react";
import { useEffect, useState } from "react";

import {
  activeCloudConnection,
  authorizeCloudCollection,
  onCloudConnectionChange,
  savedCloudConnections,
  selectedCloudCollectionId,
  selectCloudConnection,
} from "../cloud/connect";
import { createConnectTaskRepository } from "../storage/connect-repository";
import { tasknotesMarkUrl } from "./assets";
import type { CollectionChoice } from "./collection-context";
import { OpenedCollection } from "./opened-collection";

export default function CloudCollection({
  authorizationError,
  canChooseLocalFolder,
  changeLocalCollection,
  choose,
  openCollectionPicker,
  reset,
}: {
  authorizationError: string | null;
  canChooseLocalFolder: boolean;
  changeLocalCollection(): void;
  choose(choice: CollectionChoice): void;
  openCollectionPicker(): void;
  reset(): void;
}) {
  const [opened, setOpened] = useState(() => {
    const connection = activeCloudConnection();
    return connection
      ? {
          collectionId: connection.collectionId,
          repository: createConnectTaskRepository(connection),
        }
      : null;
  });

  useEffect(
    () =>
      onCloudConnectionChange((connection) => {
        setOpened(
          connection
            ? {
                collectionId: connection.collectionId,
                repository: createConnectTaskRepository(connection),
              }
            : null,
        );
      }),
    [],
  );

  if (!opened)
    return <CloudConnection error={authorizationError} onBack={reset} />;

  return (
    <OpenedCollection
      canChooseLocalFolder={canChooseLocalFolder}
      changeConnectedCollection={openCollectionPicker}
      changeLocalCollection={changeLocalCollection}
      choice="cloud"
      choose={choose}
      key={opened.collectionId}
      repository={opened.repository}
    />
  );
}

export function CloudConnection({
  error,
  onBack,
}: {
  error: string | null;
  onBack(): void;
}) {
  const [opening, setOpening] = useState<"another" | "reconnect" | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const connections = savedCloudConnections();
  const selectedCollectionId = selectedCloudCollectionId();
  const selectedConnection = connections.find(
    (connection) => connection.collectionId === selectedCollectionId,
  );

  function connect(kind: "another" | "reconnect", collectionId?: string) {
    setOpening(kind);
    setStartError(null);
    void authorizeCloudCollection(collectionId).catch((reason) => {
      setOpening(null);
      setStartError(message(reason));
    });
  }

  return (
    <main className="collection-welcome cloud-welcome">
      <div className="welcome-copy">
        <img alt="" src={tasknotesMarkUrl} />
        <p className="eyebrow">mdbase</p>
        <h1>Open your TaskNotes collection.</h1>
        <p>
          mdbase keeps large collections fast and delivers task reminders.
          Choose hosted sync or connect directly to a computer.
        </p>
      </div>
      <div className="connection-comparison" aria-label="Connection options">
        <div>
          <BellRing aria-hidden="true" size={19} />
          <span>
            <strong>Hosted mdbase</strong>
            <small>
              Syncs offline and keeps working when your computer is unavailable.
            </small>
          </span>
        </div>
        <div>
          <MonitorUp aria-hidden="true" size={19} />
          <span>
            <strong>Connect to a computer</strong>
            <small>
              Works while the computer is reachable and delivers task reminders.
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
            onClick={() => {
              selectCloudConnection(connection.collectionId, true);
              location.reload();
            }}
          >
            Open {connection.displayName}
          </button>
        ))}
        <button
          className="outline-action"
          disabled={opening !== null && !error}
          type="button"
          onClick={() => connect("another")}
        >
          {opening === "another" && !error
            ? "Opening mdbase…"
            : connections.length
              ? "Connect another collection"
              : "Continue to mdbase"}
        </button>
        {selectedCollectionId ? (
          <button
            className="text-action"
            disabled={opening !== null && !error}
            type="button"
            onClick={() => connect("reconnect", selectedCollectionId)}
          >
            {opening === "reconnect" && !error
              ? "Opening mdbase…"
              : `Reconnect ${selectedConnection?.displayName ?? "selected collection"}`}
          </button>
        ) : null}
        <button className="text-action" type="button" onClick={onBack}>
          Choose another location
        </button>
      </div>
    </main>
  );
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
