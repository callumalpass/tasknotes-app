import { useState } from "react";
import { deferPwaUpdate, usePwaUpdate } from "../pwa/update";

export function AppUpdateNotice({
  reload = () => window.location.reload(),
}: {
  reload?: () => void;
}) {
  const available = usePwaUpdate();
  const [reloading, setReloading] = useState(false);
  if (!available) return null;
  return (
    <aside className="app-update-notice" aria-label="App update">
      <p role="status">
        A TaskNotes update is ready. Save your changes, then reload.
      </p>
      <div>
        <button
          type="button"
          disabled={reloading}
          onClick={() => {
            if (reloading) return;
            setReloading(true);
            reload();
          }}
        >
          {reloading ? "Reloading…" : "Reload TaskNotes"}
        </button>
        <button type="button" disabled={reloading} onClick={deferPwaUpdate}>
          Later
        </button>
      </div>
    </aside>
  );
}
