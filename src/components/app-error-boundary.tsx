import { Trans } from "@lingui/react/macro";
import { Component, type ErrorInfo, type ReactNode } from "react";

import { tasknotesMarkUrl } from "../app/assets";

export class AppErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("TaskNotes render failed", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="opening-screen storage-error">
        <img alt="" src={tasknotesMarkUrl} />
        <h1>
          <Trans>TaskNotes needs to restart.</Trans>
        </h1>
        <p>
          <Trans>
            Your collection has not been removed. Restart the app to reopen your
            tasks.
          </Trans>
        </p>
        <button
          className="outline-action"
          type="button"
          onClick={() => window.location.reload()}
        >
          <Trans>Restart TaskNotes</Trans>
        </button>
        <details className="technical-details">
          <summary>
            <Trans>Technical details</Trans>
          </summary>
          <p>{this.state.error.message}</p>
        </details>
      </main>
    );
  }
}
