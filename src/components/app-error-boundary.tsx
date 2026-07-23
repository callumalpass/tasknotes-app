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
        <h1>TaskNotes needs to restart.</h1>
        <p>
          Your collection has not been removed. Restart the app to reopen your
          tasks.
        </p>
        <button
          className="outline-action"
          type="button"
          onClick={() => window.location.reload()}
        >
          Restart TaskNotes
        </button>
        <details className="technical-details">
          <summary>Technical details</summary>
          <p>{this.state.error.message}</p>
        </details>
      </main>
    );
  }
}
