import { useLingui as useI18n } from "@lingui/react";

import { Trans } from "@lingui/react/macro";
import { t as translate } from "@lingui/core/macro";
import { useContext, useEffect, useState } from "react";
import { ConnectionNoticeContext } from "../app/connection-notice";
import { useRepository } from "../app/repository-context";
import { HeldEditsNotice } from "./held-edits";

export function CollectionAvailability({
  onSettings,
}: {
  onSettings?: () => void;
}) {
  useI18n();
  const { connection, refresh, refreshing } = useRepository();
  const waitingForComputer =
    useContext(ConnectionNoticeContext) === "waiting_for_computer";
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
  if (connection.state !== "unavailable" && !waitingForComputer) {
    return (
      <>
        {protectedEdits}
        {waiting && prolonged ? (
          <div className="collection-connection-indicator" role="status">
            {connection.state === "connecting"
              ? translate({ message: "Connecting…" })
              : translate({ message: "Refreshing…" })}
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
        aria-label={translate({ message: "Collection connection" })}
      >
        <div role="status">
          <span>
            {waitingForComputer
              ? translate({
                  message:
                    "Waiting for your computer. Previously loaded tasks stay here; they will refresh when it reconnects.",
                })
              : translate({
                  message:
                    "Collection unavailable. Showing previously loaded tasks; changes can’t be saved.",
                })}
          </span>
          {failed && !waitingForComputer ? (
            <p>
              <Trans>
                Could not reconnect. Try again or check connection settings.
              </Trans>
            </p>
          ) : null}
        </div>
        <div className="availability-actions">
          {!waitingForComputer ? (
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
                ? translate({ message: "Reconnecting…" })
                : translate({ message: "Retry connection" })}
            </button>
          ) : null}
          {onSettings ? (
            <button className="text-action" type="button" onClick={onSettings}>
              <Trans>Connection settings</Trans>
            </button>
          ) : null}
        </div>
      </section>
    </>
  );
}
