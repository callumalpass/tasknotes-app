import { useState } from "react";
import type { Mdbase } from "@mdbase-dev/sdk";
import { tasknotesMarkUrl } from "./assets";

export function AccountUpgradeWait({ mdbase }: { mdbase: Mdbase }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <main className="opening-screen" aria-labelledby="upgrade-title">
      <img alt="" src={tasknotesMarkUrl} width="48" height="48" />
      <h1 id="upgrade-title">Your account is being upgraded</h1>
      <p role="status">
        Your account is being upgraded; this usually completes within a day.
        Your tasks are safe.
      </p>
      {failed ? (
        <p role="status">Still waiting. Please try again later.</p>
      ) : null}
      <button
        className="primary-action"
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setFailed(false);
          // Read-only recheck. Never repeat a write, re-enrol, clear storage,
          // switch backends or claim readiness based on this screen.
          void mdbase
            .start()
            .then(() => mdbase.refreshCollectionList())
            .then(() => mdbase.assess())
            .catch(() => setFailed(true))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Checking…" : "Retry"}
      </button>
    </main>
  );
}
