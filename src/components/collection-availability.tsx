import { useEffect, useState } from "react";
import { useRepository } from "../app/repository-context";
import { HeldEditsNotice } from "./held-edits";

export function CollectionAvailability({
  onSettings,
}: {
  onSettings?: () => void;
}) {
  const { connection, refresh, refreshing } = useRepository();
  const [failed, setFailed] = useState(false);
  const waiting =
    connection.state === "connecting" ||
    (connection.state === "connected" && refreshing);
  const [prolonged, setProlonged] = useState(false);
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setTimeout(() => setProlonged(true), 5_000);
    return () => {
      window.clearTimeout(timer);
      setProlonged(false);
    };
  }, [waiting]);

  const protectedEdits = (
    <HeldEditsNotice
      edits={connection.heldEdits ?? []}
      count={connection.sync?.held}
      onReview={onSettings}
    />
  );
  if (connection.state !== "unavailable") {
    return (
      <>
        {protectedEdits}
        {waiting && prolonged ? (
          <div className="collection-connection-indicator" role="status">
            {connection.state === "connecting" ? "Connecting…" : "Refreshing…"}
          </div>
        ) : null}
      </>
    );
  }
  return (
    <>
      {protectedEdits}
      <section
        className="collection-availability"
        aria-label="Collection connection"
      >
        <div role="status">
          <span>
            Collection unavailable. Showing previously loaded tasks; changes
            can’t be saved.
          </span>
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
    </>
  );
}
