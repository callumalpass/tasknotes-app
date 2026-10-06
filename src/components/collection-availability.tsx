import { useLingui, Trans } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { useRepository } from "../app/repository-context";

export function CollectionAvailability({
  onSettings,
}: {
  onSettings?: () => void;
}) {
  const { t } = useLingui();
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

  if (connection.state !== "unavailable") {
    return waiting && prolonged ? (
      <div className="collection-connection-indicator" role="status">
        {connection.state === "connecting"
          ? t({ message: "Connecting…" })
          : t({ message: "Refreshing…" })}
      </div>
    ) : null;
  }
  return (
    <section
      className="collection-availability"
      aria-label={t({ message: "Collection connection" })}
    >
      <div role="status">
        <span>
          <Trans>
            Collection unavailable. Showing previously loaded tasks; changes
            can’t be saved.
          </Trans>
        </span>
        {failed ? (
          <p>
            <Trans>
              Could not reconnect. Try again or check connection settings.
            </Trans>
          </p>
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
          {refreshing
            ? t({ message: "Reconnecting…" })
            : t({ message: "Retry connection" })}
        </button>
        {onSettings ? (
          <button className="text-action" type="button" onClick={onSettings}>
            <Trans>Connection settings</Trans>
          </button>
        ) : null}
      </div>
    </section>
  );
}
