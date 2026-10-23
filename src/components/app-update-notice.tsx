import { Trans } from "@lingui/react/macro";
import { t as translate } from "@lingui/core/macro";
import { useState } from "react";
import { deferPwaUpdate, activatePwaUpdate, usePwaUpdate } from "../pwa/update";
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
    <aside
      className="app-update-notice"
      aria-label={translate({ message: "App update" })}
    >
      <p role="status">
        <Trans>
          A TaskNotes update is ready. Save your changes, then reload.
        </Trans>
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
              .then(activatePwaUpdate)
              .then(reload)
              .catch((reason: unknown) => {
                setError(
                  reason instanceof Error
                    ? reason.message
                    : translate({
                        message:
                          "Changes could not be saved. Keep this page open and try again.",
                      }),
                );
                setReloading(false);
              });
          }}
        >
          {reloading
            ? translate({ message: "Saving changes…" })
            : translate({ message: "Save and reload TaskNotes" })}
        </button>
        <button type="button" disabled={reloading} onClick={deferPwaUpdate}>
          <Trans>Later</Trans>
        </button>
      </div>
    </aside>
  );
}
