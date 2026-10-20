import { useState } from "react";
import { describeError, type Mdbase } from "@mdbase-dev/sdk";
import { isAccountUpgradeWait } from "./account-upgrade-state";
import { tasknotesMarkUrl } from "./assets";

// The SDK's shared copy, so TaskNotes says the same thing as the server's
// retry hint and the SDK's own sync status. Never a raw code.
const upgrade = describeError("collection_migrating");
const title = upgrade?.title ?? "Your collection is being upgraded";
const message =
  upgrade?.message ??
  "Your data is safe. This usually takes a few minutes, and the app reconnects by itself when it's done.";

/**
 * `screen` replaces the app before a collection is open. `banner` sits above
 * an open workspace so unsaved drafts stay visible and editable.
 */
export function AccountUpgradeWait({
  mdbase,
  variant = "screen",
}: {
  mdbase: Mdbase;
  variant?: "screen" | "banner";
}) {
  const [busy, setBusy] = useState(false);
  const [stillWaiting, setStillWaiting] = useState(false);
  const retry = (
    <button
      className={variant === "screen" ? "primary-action" : "outline-action"}
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        setStillWaiting(false);
        // Read-only recheck. Never repeat a write, re-enrol, clear storage,
        // switch backends or claim readiness based on this screen.
        void mdbase
          .start()
          .then(() => mdbase.refreshCollectionList())
          .then(() => mdbase.assess())
          .then(
            () => setStillWaiting(isAccountUpgradeWait(mdbase.getSnapshot())),
            () => setStillWaiting(true),
          )
          .finally(() => setBusy(false));
      }}
    >
      {busy ? "Checking…" : "Check now"}
    </button>
  );
  const waiting = stillWaiting ? (
    <p role="status">Still upgrading. TaskNotes will keep checking.</p>
  ) : null;
  if (variant === "banner")
    return (
      <section
        className="settings-banner upgrade-banner"
        aria-labelledby="upgrade-title"
      >
        <p>
          <strong id="upgrade-title">{title}</strong>
        </p>
        <p role="status">{message}</p>
        {waiting}
        <div className="settings-actions">{retry}</div>
      </section>
    );
  return (
    <main className="opening-screen" aria-labelledby="upgrade-title">
      <img alt="" src={tasknotesMarkUrl} width="48" height="48" />
      <h1 id="upgrade-title">{title}</h1>
      <p role="status">{message}</p>
      {waiting}
      {retry}
    </main>
  );
}
