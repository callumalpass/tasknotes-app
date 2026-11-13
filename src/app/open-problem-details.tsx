import { Trans } from "@lingui/react/macro";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { Mdbase } from "@mdbase-dev/sdk";
import { FeedbackButton } from "@mdbase-dev/ui/feedback";

import { ReportFailure } from "./feedback-root";
import { openProblemReference } from "./open-problem-reference";

/**
 * Shown under the shared gate's problem screen: a way to report it and the
 * SDK's code, which the shared copy deliberately leaves out. Rendered only
 * while the gate shows a problem, so the failure is one the person can see.
 */
export function OpenProblemDetails({ mdbase }: { readonly mdbase: Mdbase }) {
  const subscribe = useCallback(
    (listener: () => void) => mdbase.subscribe(listener),
    [mdbase],
  );
  const getSnapshot = useCallback(() => mdbase.getSnapshot(), [mdbase]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  const reference = openProblemReference(snapshot);
  const code = reference?.code ?? null;
  const developerMessage = reference?.developerMessage ?? null;
  useEffect(() => {
    if (code === null) return;
    // Developer detail for the console only; it never reaches the screen.
    console.warn(
      `TaskNotes could not open the collection: mdbase problem ${code}.`,
      developerMessage ?? "",
    );
  }, [code, developerMessage]);
  if (!reference) return null;
  return (
    <div className="open-problem-details">
      <ReportFailure code="source_open_failed" view="opening" />
      <FeedbackButton className="failure-feedback" topic="problem" />
      <details className="technical-details">
        <summary>
          <Trans>Technical details</Trans>
        </summary>
        <p>
          <Trans>
            Error code: <code>{reference.code}</code>
          </Trans>
        </p>
      </details>
    </div>
  );
}
