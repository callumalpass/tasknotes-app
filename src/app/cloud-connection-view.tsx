import { ArrowRight, ChevronDown, Cloud, Monitor, Plus } from "lucide-react";
import type { AppWebSignInSnapshot } from "@mdbase-dev/sdk/app-host";
import type { useCloudSessionSnapshot } from "../cloud/use-session";
import { tasknotesMarkUrl } from "./assets";
import { collectionErrorMessage as message } from "./collection-error";
export interface CloudConnectionViewProps {
  session: AppWebSignInSnapshot | ReturnType<typeof useCloudSessionSnapshot>;
  sdk?: { snapshot: AppWebSignInSnapshot };
  error: string | null;
  startError: string | null;
  retryAuthorization?: () => void;
  reviewingCollection: boolean;
  firstVisit: boolean;
  busy: boolean;
  sdkWaiting: boolean;
  authorizationPending: boolean;
  opening: "another" | "reconnect" | null;
  openingCollectionId: string | null;
  selectedCollectionId: string | null;
  selectedConnection?: { displayName: string };
  availableConnections: readonly {
    collectionId: string;
    displayName: string;
  }[];
  authorityFor?: (collectionId: string) => boolean | null;
  connect(kind: "another" | "reconnect"): Promise<void>;
  open(collectionId: string): Promise<void>;
  applyCollectionSetup(): Promise<void>;
  cancelAuthorization(): void;
  onTryDemo?: () => void;
}
/** Existing production JSX, moved intact so native UI imports no legacy runtime. */
export function CloudConnectionView({
  session,
  sdk,
  error,
  startError,
  retryAuthorization,
  reviewingCollection,
  firstVisit,
  busy,
  sdkWaiting,
  authorizationPending,
  opening,
  openingCollectionId,
  selectedCollectionId,
  selectedConnection,
  availableConnections,
  authorityFor,
  connect,
  open,
  applyCollectionSetup,
  cancelAuthorization,
  onTryDemo,
}: CloudConnectionViewProps) {
  return (
    <main className="collection-welcome cloud-welcome">
      <div className="welcome-copy">
        <img alt="" src={tasknotesMarkUrl} />
        <h1>
          {reviewingCollection
            ? "Finish opening TaskNotes"
            : firstVisit
              ? "Connect TaskNotes to your tasks"
              : "Welcome back"}
        </h1>
        <p>
          {reviewingCollection
            ? "Complete this collection’s setup, or choose a different collection."
            : firstVisit
              ? "TaskNotes works with collections managed by mdbase."
              : "Choose a collection to open your tasks."}
        </p>
        <details className="mdbase-explainer">
          <summary>
            <span>What is mdbase?</span>
            <ChevronDown aria-hidden="true" size={16} />
          </summary>
          <p>
            mdbase keeps your tasks as portable Markdown files while giving
            compatible apps a shared way to understand them. mdbase Connect lets
            you choose a collection and approve TaskNotes’ access—whether it’s
            hosted by mdbase or available from a connected computer.
          </p>
        </details>
      </div>
      {error || startError ? (
        <>
          <p className="inline-error" role="alert">
            {error ?? startError}
          </p>
          {error && retryAuthorization ? (
            <button
              className="outline-action"
              onClick={retryAuthorization}
              type="button"
            >
              Retry authorization
            </button>
          ) : null}
        </>
      ) : null}
      {sdk?.snapshot.signIn?.state === "paired" &&
      sdk.snapshot.signIn.accountEmail ? (
        <p className="connection-status">
          Signed in as {sdk.snapshot.signIn.accountEmail}
        </p>
      ) : null}
      {session.status === "checking_setup" ? (
        <p className="connection-status" role="status">
          Checking this collection’s TaskNotes setup…
        </p>
      ) : null}
      {session.status === "blocked" && !sdk ? (
        <p className="inline-error" role="alert">
          {message({ problem: session.problem })}
        </p>
      ) : null}
      {session.status === "setup_review_required" ? (
        <section
          className="connection-update"
          aria-labelledby="collection-setup-title"
        >
          <h2 id="collection-setup-title">Review TaskNotes setup</h2>
          <p>
            TaskNotes needs the following collection settings and definitions.
            Your task records and unrelated collection settings will not change.
          </p>
          <ul>
            {session.update.configuration
              .filter((configuration) => configuration.action !== "current")
              .map((configuration) => (
                <li key={configuration.requirement}>
                  {configuration.action === "conflict"
                    ? configuration.conflict?.message
                    : `Allow TaskNotes Base views at ${String(configuration.value)}`}
                </li>
              ))}
            {session.update.typePacks.map((update) => (
              <li key={update.id}>
                {update.name}: {update.currentVersion ?? "not installed"} →{" "}
                {update.desiredVersion}
              </li>
            ))}
          </ul>
          <p>
            If you do not approve this setup, TaskNotes cannot create its
            portable views in this collection. You can choose another collection
            below.
          </p>
          <button
            className="outline-action"
            disabled={opening !== null || !session.update.canApply}
            onClick={() => void applyCollectionSetup()}
            type="button"
          >
            Apply reviewed setup
          </button>
        </section>
      ) : null}
      {session.status === "authorization_required" ? (
        <section
          className="connection-update"
          aria-labelledby="access-review-title"
        >
          <h2 id="access-review-title">Review updated access</h2>
          <p>
            TaskNotes needs you to review its updated collection access in
            mdbase before this collection can open.
          </p>
          <button
            className="outline-action"
            disabled={opening !== null}
            onClick={() => void connect("reconnect")}
            type="button"
          >
            {opening === "reconnect"
              ? "Opening mdbase…"
              : "Review updated access"}
          </button>
        </section>
      ) : null}
      <div className="welcome-actions">
        {availableConnections.length ? (
          <section
            aria-labelledby="recent-collections-title"
            className="welcome-collections"
          >
            <h2 id="recent-collections-title">
              {sdk || reviewingCollection
                ? "Other collections"
                : "Recent collections"}
            </h2>
            <div className="welcome-collection-list">
              {availableConnections.map((connection) => {
                // Discovery does not expose provider metadata. Do not guess.
                const hosted = authorityFor?.(connection.collectionId) ?? null;
                const authorityLabel =
                  hosted === null
                    ? null
                    : hosted
                      ? "Hosted by mdbase"
                      : "Connected computer";
                const action =
                  session.status === "setup_review_required" ? "Use" : "Open";
                return (
                  <button
                    aria-label={`${action} ${connection.displayName}${authorityLabel ? `, ${authorityLabel}` : ""}`}
                    className="welcome-collection-row"
                    disabled={busy}
                    key={connection.collectionId}
                    onClick={() => void open(connection.collectionId)}
                    type="button"
                  >
                    {authorityLabel ? (
                      <span className="welcome-collection-icon">
                        {hosted ? (
                          <Cloud aria-hidden="true" size={19} />
                        ) : (
                          <Monitor aria-hidden="true" size={19} />
                        )}
                      </span>
                    ) : null}
                    <span className="welcome-collection-copy">
                      <strong>{connection.displayName}</strong>
                      {authorityLabel ? <small>{authorityLabel}</small> : null}
                    </span>
                    <span className="welcome-collection-open">
                      {openingCollectionId === connection.collectionId ? (
                        "Opening…"
                      ) : (
                        <ArrowRight aria-hidden="true" size={18} />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}
        <div className="welcome-connect-action">
          <button
            className={
              firstVisit
                ? "welcome-primary-action"
                : "outline-action welcome-secondary-action"
            }
            disabled={busy}
            type="button"
            onClick={() => void connect("another")}
          >
            {opening === "another" ? (
              <span className="welcome-opening-label">Opening mdbase…</span>
            ) : (
              <>
                <Plus aria-hidden="true" size={18} />
                <span>
                  {reviewingCollection
                    ? "Choose a different collection in mdbase"
                    : firstVisit
                      ? sdk && sdk.snapshot.signIn?.state !== "paired"
                        ? "Sign in"
                        : "Choose a collection"
                      : "Choose another collection in mdbase"}
                </span>
                <ArrowRight aria-hidden="true" size={18} />
              </>
            )}
          </button>
          <p role={authorizationPending || sdkWaiting ? "status" : undefined}>
            {sdkWaiting
              ? "Waiting for approval in the mdbase window…"
              : authorizationPending
                ? "Complete your selection in the mdbase window."
                : "mdbase will open so you can choose a collection and approve access."}
          </p>
        </div>
        {selectedCollectionId &&
        session.status !== "setup_review_required" &&
        session.status !== "authorization_required" &&
        !sdk ? (
          <button
            className="text-action"
            disabled={busy}
            type="button"
            onClick={() => void connect("reconnect")}
          >
            {opening === "reconnect"
              ? "Opening mdbase…"
              : `Reconnect ${selectedConnection?.displayName ?? "selected collection"}`}
          </button>
        ) : null}
        {authorizationPending && !sdk ? (
          <button
            className="welcome-cancel-action"
            onClick={cancelAuthorization}
            type="button"
          >
            Cancel
          </button>
        ) : null}
        {onTryDemo ? (
          <button
            className="welcome-demo-action"
            disabled={busy}
            onClick={onTryDemo}
            type="button"
          >
            Try a disposable demo
          </button>
        ) : null}
      </div>
    </main>
  );
}
