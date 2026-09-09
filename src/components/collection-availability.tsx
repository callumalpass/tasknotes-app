import { useState } from "react";
import { useRepository } from "../app/repository-context";

export function CollectionAvailability({
  onSettings,
}: {
  onSettings?: () => void;
}) {
  const { connection, refresh, refreshing } = useRepository();
  const [failed, setFailed] = useState(false);
  if (connection?.state !== "unavailable" && connection?.state !== "connecting")
    return null;
  return (
    <section
      className="collection-availability"
      aria-label="Collection connection"
    >
      <div role="status">
        <strong>
          {connection.state === "connecting"
            ? "Connecting to collection…"
            : "Collection unavailable"}
        </strong>
        <p>
          Showing previously loaded tasks. A connection is needed to save
          changes.
        </p>
        {failed ? (
          <p>Could not reconnect. Try again or check connection settings.</p>
        ) : null}
      </div>
      <div className="availability-actions">
        <button
          className="text-action"
          type="button"
          disabled={refreshing}
          onClick={() => {
            setFailed(false);
            void refresh().catch(() => setFailed(true));
          }}
        >
          {refreshing ? "Reconnecting…" : "Retry connection"}
        </button>
        {onSettings ? (
          <button className="text-action" type="button" onClick={onSettings}>
            Connection settings
          </button>
        ) : null}
      </div>
    </section>
  );
}
