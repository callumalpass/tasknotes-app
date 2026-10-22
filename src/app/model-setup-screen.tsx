import { useCallback, useEffect, useRef, useState } from "react";
import {
  ModelSetupError,
  type ModelSetupView,
  type ModelSetupProgress,
  type TaskNotesModelSetup,
} from "../application/ports/model-setup";

/** No task views mount until the original repository can read its model. */
export function ModelSetupScreen({
  setup,
  onReady,
  changeCollection,
  reauthorizeCollection,
}: {
  setup: TaskNotesModelSetup;
  onReady(): Promise<unknown>;
  changeCollection(): void;
  reauthorizeCollection(): void;
}) {
  const [view, setView] = useState<ModelSetupView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<ModelSetupProgress | null>(null);
  const operationInProgress = useRef(false);
  useEffect(() => {
    let active = true;
    let generation = 0;
    let waited = false;
    const inspect = async () => {
      const current = ++generation;
      try {
        const next = await setup.inspect();
        if (!active || current !== generation) return;
        setView(next);
        if (next.state === "waiting") waited = true;
        else if (
          next.state === "ready" &&
          waited &&
          !operationInProgress.current
        ) {
          waited = false;
          // Reopening an already configured collection is read-only. This
          // cannot install, resume or finish an original creator controller.
          await onReady();
        }
      } catch (reason) {
        if (active && current === generation)
          setView({
            state: "blocked",
            message:
              reason instanceof Error
                ? reason.message
                : "Collection access is unavailable.",
          });
      }
    };
    void inspect();
    const stop = setup.onReadinessChange?.(() => void inspect());
    return () => {
      active = false;
      generation++;
      stop?.();
    };
  }, [setup, onReady]);

  const run = useCallback(
    async (action: "install" | "resume" | "inspect") => {
      if (busy || operationInProgress.current) return;
      operationInProgress.current = true;
      setBusy(true);
      setError("");
      setProgress(null);
      const operation = { progress: null as ModelSetupProgress | null };
      const report = (next: ModelSetupProgress) => {
        // Once the original deadline expires, stay truthful about checking
        // its outcome even if the provider enters a receipt/readback phase.
        if (operation.progress === "checking_outcome") return;
        operation.progress = next;
        setProgress(next);
      };
      try {
        if (action !== "inspect") await setup[action](report);
        const next = await setup.inspect();
        setView(next);
        if (next.state === "ready") {
          // A read-only check cannot complete a retained creation target. This
          // is an idempotent read/no-op when definitions already exist.
          if (action === "inspect") await setup.install(report);
          await onReady();
        }
      } catch (reason) {
        const checkingOriginalOutcome =
          operation.progress === "checking_outcome" &&
          reason instanceof ModelSetupError &&
          reason.view.state === "outcome_unknown";
        setError(
          checkingOriginalOutcome
            ? ""
            : reason instanceof Error
              ? reason.message
              : "TaskNotes setup is unavailable.",
        );
        if (reason instanceof ModelSetupError) setView(reason.view);
        else {
          try {
            setView(await setup.inspect());
          } catch {
            /* Preserve the visible recovery state. */
          }
        }
      } finally {
        operationInProgress.current = false;
        setBusy(false);
      }
    },
    [busy, onReady, setup],
  );

  return (
    <main className="opening-screen">
      <h1>
        {!view
          ? "Opening collection"
          : view.state === "waiting"
            ? view.reason === "waiting_for_access"
              ? "Waiting for access"
              : "Catching up"
            : "Set up TaskNotes"}
      </h1>
      {view && view.state !== "waiting" ? (
        <p>
          This collection needs its TaskNotes setup before tasks and views can
          open. New setup installs the published models and adds Today,
          Upcoming, Calendar, Projects and Archive. Existing view sources stay
          unchanged; interrupted setup resumes only its original changes.
        </p>
      ) : null}
      {!view ? <p role="status">Checking collection access…</p> : null}
      {view?.state === "waiting" ? <p role="status">{view.message}</p> : null}
      {view?.state === "required" ? (
        <button disabled={busy} onClick={() => void run("install")}>
          Set up TaskNotes
        </button>
      ) : null}
      {view?.state === "outcome_unknown" ? (
        <>
          <p role="status">Setup outcome unknown. {view.message}</p>
          <button disabled={busy} onClick={() => void run("resume")}>
            Resume original setup
          </button>
        </>
      ) : null}
      {view?.state === "permission_required" ? (
        <>
          <p role="alert">{view.message}</p>
          <button disabled={busy} onClick={reauthorizeCollection}>
            Review collection permission
          </button>
        </>
      ) : null}
      {view?.state === "blocked" ? <p role="alert">{view.message}</p> : null}
      {view &&
      view.state !== "waiting" &&
      view.state !== "required" &&
      view.state !== "outcome_unknown" ? (
        <button disabled={busy} onClick={() => void run("inspect")}>
          Check setup
        </button>
      ) : null}
      {busy && view?.state !== "waiting" ? (
        <p role="status">
          {progress === "checking_outcome"
            ? "Checking whether setup finished…"
            : progress === "waiting_for_confirmation"
              ? "Waiting for setup confirmation…"
              : progress === "installing"
                ? "Installing TaskNotes setup…"
                : "Checking TaskNotes setup…"}
        </p>
      ) : null}
      {error && view?.state !== "waiting" ? <p role="alert">{error}</p> : null}
      <button
        className="text-action"
        disabled={busy}
        onClick={changeCollection}
      >
        Choose another collection
      </button>
    </main>
  );
}
