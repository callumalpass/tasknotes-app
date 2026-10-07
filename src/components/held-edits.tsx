import { useEffect, useRef, useState } from "react";
import { useRepository } from "../app/repository-context";
import type {
  HeldEdit,
  HeldEditAction,
} from "../application/ports/task-repository";
import "./held-edits.css";

export function HeldEditsNotice({
  edits,
  count = edits.length,
  onReview,
}: {
  edits: HeldEdit[];
  count?: number;
  onReview?(): void;
}) {
  const total = Math.max(count, edits.length);
  if (!total) return null;
  return (
    <div className="collection-held-notice" role="status">
      <div>
        <strong>mdbase protected your edit</strong>
        <p>
          {total === 1 && edits[0]
            ? `${edits[0].path} is waiting for your choice. ${edits[0].cause}`
            : `${total} edits are waiting for your choice.`}
        </p>
      </div>
      {onReview ? (
        <button className="text-action" type="button" onClick={onReview}>
          Review protected edits
        </button>
      ) : null}
    </div>
  );
}

const owners = new WeakMap<object, number>();
let nextOwner = 0;
/** Retire all drafts/notices when the collection owner changes. */
export function HeldEditsReview({ edits }: { edits: HeldEdit[] }) {
  const { repository } = useRepository();
  let owner = owners.get(repository);
  if (owner === undefined) {
    owner = ++nextOwner;
    owners.set(repository, owner);
  }
  return <HeldEditsPanel key={owner} edits={edits} />;
}

/** Never retries a resolution or treats its return as a confirmed save. */
function HeldEditsPanel({ edits }: { edits: HeldEdit[] }) {
  const { repository, refresh } = useRepository();
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [comparison, setComparison] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{
    id: string;
    action: HeldEditAction;
  } | null>(null);
  const scope = useRef<AbortController | null>(null);
  const working = useRef(false);
  useEffect(() => {
    const lifetime = new AbortController();
    scope.current = lifetime;
    return () => lifetime.abort();
  }, [repository]);

  async function choose(edit: HeldEdit, action: HeldEditAction) {
    const lifetime = scope.current;
    if (
      !repository.resolveHeldEdit ||
      !lifetime ||
      lifetime.signal.aborted ||
      working.current ||
      !edit.actions.some((choice) => choice.action === action.action)
    )
      return;
    working.current = true;
    setBusy(edit.id);
    setProblem(null);
    setNotice(null);
    setConfirmation(null);
    try {
      await repository.resolveHeldEdit(edit.id, action.action);
      if (lifetime.signal.aborted) return;
      setNotice(
        "Choice submitted. It may still be pending sync; check the confirmed, pending and held counts.",
      );
      try {
        await refresh();
      } catch {
        if (!lifetime.signal.aborted)
          setProblem(
            "Your choice was submitted, but the latest status could not be read. Refresh before making another choice.",
          );
      }
    } catch {
      if (!lifetime.signal.aborted)
        setProblem(
          "Could not confirm the outcome of your choice. Refresh and review the current protected edit before trying again.",
        );
    } finally {
      working.current = false;
      if (!lifetime.signal.aborted) setBusy(null);
    }
  }

  return (
    <div className="held-edits" role="region" aria-label="Protected edits">
      {edits.map((edit) => (
        <article className="held-edit" key={edit.id}>
          <h3>{edit.title}</h3>
          <p className="held-edit-path">{edit.path}</p>
          <p>{edit.cause}</p>
          <p className="section-copy">{edit.detail}</p>
          {edit.comparison ? (
            <button
              className="text-action"
              type="button"
              onClick={() =>
                setComparison((id) => (id === edit.id ? null : edit.id))
              }
            >
              {comparison === edit.id
                ? "Close comparison"
                : "Compare side by side"}
            </button>
          ) : (
            <p className="section-copy">
              {edit.comparisonUnavailable ??
                "Comparison is not available from this backend."}
            </p>
          )}
          {comparison === edit.id && edit.comparison ? (
            <div
              className="held-comparison"
              role="group"
              aria-label={`Versions of ${edit.path}`}
            >
              <label>
                Your protected version
                <textarea
                  readOnly
                  autoComplete="off"
                  spellCheck={false}
                  value={edit.comparison.mine}
                />
              </label>
              <label>
                Synced version
                <textarea
                  readOnly
                  autoComplete="off"
                  spellCheck={false}
                  value={edit.comparison.theirs}
                />
              </label>
              {edit.comparison.shortened ? (
                <p className="held-comparison-note section-copy">
                  These previews are shortened. Choices apply to the full
                  versions, not the previews. Keep both to preserve your full
                  edit.
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="held-edit-actions">
            {[...edit.actions]
              .sort((a, b) => Number(a.discardsMine) - Number(b.discardsMine))
              .map((action) => (
                <button
                  className="text-action"
                  type="button"
                  key={action.action}
                  title={action.description}
                  disabled={busy !== null || !repository.resolveHeldEdit}
                  onClick={() =>
                    action.discardsMine
                      ? setConfirmation({ id: edit.id, action })
                      : void choose(edit, action)
                  }
                >
                  {busy === edit.id ? "Submitting…" : action.label}
                </button>
              ))}
          </div>
          {confirmation?.id === edit.id &&
          edit.actions.some(
            (choice) => choice.action === confirmation.action.action,
          ) ? (
            <div
              role="group"
              aria-label="Confirm protected-version replacement"
            >
              <p>
                {confirmation.action.description} This discards your protected
                version.{" "}
                {edit.actions.some((action) => action.action === "keep_both")
                  ? "Keep both instead if you want your edit kept as a file."
                  : "Keep mine instead if you want to keep your edit."}
              </p>
              <button
                className="text-action"
                type="button"
                disabled={busy !== null}
                onClick={() => void choose(edit, confirmation.action)}
              >
                Confirm {confirmation.action.label.toLowerCase()}
              </button>
              <button
                className="text-action"
                type="button"
                onClick={() => setConfirmation(null)}
              >
                Cancel
              </button>
            </div>
          ) : null}
          <p className="section-copy">{edit.reversibleNote}</p>
        </article>
      ))}
      {notice ? <p role="status">{notice}</p> : null}
      {problem ? (
        <p className="inline-error" role="alert">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
