import { useState } from "react";
import {
  deferPwaUpdate,
  markPwaUpdateReloaded,
  usePwaUpdate,
} from "../pwa/update";
import { saveBeforeReload } from "../pwa/reload";

export function AppUpdateNotice({
  reload = () => window.location.reload(),
  save = saveBeforeReload,
}: {
  reload?: () => void;
  save?: () => Promise<void>;
}) {
  const available = usePwaUpdate();
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!available) return null;
  return (
    <aside className="app-update-notice" aria-label="App update">
      <p role="status">
        A TaskNotes update is ready. Save your changes, then reload.
      </p>
      {error && <p role="alert">{error}</p>}
      <div>
        <button
          type="button"
          disabled={reloading}
          onClick={() => {
            if (reloading) return;
            setReloading(true);
            setError(null);
            void save()
              .then(() => {
                markPwaUpdateReloaded();
                reload();
              })
              .catch((reason: unknown) => {
                setError(
                  reason instanceof Error
                    ? reason.message
                    : "Changes could not be saved. Keep this page open and try again.",
                );
                setReloading(false);
              });
          }}
        >
          {reloading ? "Saving changes…" : "Save and reload TaskNotes"}
        </button>
        <button type="button" disabled={reloading} onClick={deferPwaUpdate}>
          Later
        </button>
      </div>
    </aside>
  );
}
