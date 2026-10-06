import { useEffect, useState } from "react";
import { useRepository } from "../app/repository-context";

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

  const held = connection.heldEdits?.length ?? 0;
  if (connection.state !== "unavailable") {
    return (
      <>
        {held ? (
          <div className="collection-held-notice" role="status">
            <span>
              mdbase protected your edit:{" "}
              {held === 1
                ? `${connection.heldEdits![0]!.path} is waiting for your choice.`
                : `${held} files are waiting for your choice.`}
            </span>
            {onSettings ? (
              <button
                className="text-action"
                type="button"
                onClick={onSettings}
              >
                Review
              </button>
            ) : null}
          </div>
        ) : null}
        {waiting && prolonged ? (
          <div className="collection-connection-indicator" role="status">
            {connection.state === "connecting" ? "Connecting…" : "Refreshing…"}
          </div>
        ) : null}
      </>
    );
  }
  return (
    <section
      className="collection-availability"
      aria-label="Collection connection"
    >
      <div role="status">
        <span>
          Collection unavailable. Showing previously loaded tasks; changes can’t
          be saved.
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
  );
}
