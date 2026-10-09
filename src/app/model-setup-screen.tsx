import { useCallback, useEffect, useState } from "react";
import {
  ModelSetupError,
  type ModelSetupView,
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
  useEffect(() => {
    let active = true;
    void setup.inspect().then(
      (next) => {
        if (active) setView(next);
      },
      (reason: unknown) => {
        if (active)
          setView({
            state: "blocked",
            message:
              reason instanceof Error
                ? reason.message
                : "Original setup is unavailable.",
          });
      },
    );
    return () => {
      active = false;
    };
  }, [setup]);

  const run = useCallback(
    async (action: "install" | "resume" | "inspect") => {
      if (busy) return;
      setBusy(true);
      setError("");
      try {
        if (action !== "inspect") await setup[action]();
        const next = await setup.inspect();
        setView(next);
        if (next.state === "ready") {
          // A read-only check cannot complete a retained creation target. This
          // is an idempotent read/no-op when definitions already exist.
          if (action === "inspect") await setup.install();
          await onReady();
        }
      } catch (reason) {
        setError(
          reason instanceof Error
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
        setBusy(false);
      }
    },
    [busy, onReady, setup],
  );

  return (
    <main className="opening-screen">
      <h1>Set up TaskNotes</h1>
      <p>
        This collection needs the TaskNotes model before its tasks and views can
        open. Setup adds definitions without replacing existing files.
      </p>
      {!view ? <p role="status">Checking the original collection…</p> : null}
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
      {view && view.state !== "required" && view.state !== "outcome_unknown" ? (
        <button disabled={busy} onClick={() => void run("inspect")}>
          Check setup
        </button>
      ) : null}
      {busy ? <p role="status">Checking TaskNotes setup…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
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
