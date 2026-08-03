import { FileKey2, ShieldCheck } from "lucide-react";
import { useEffect, useRef } from "react";

import type { ManagedTypeUpgradeRequest } from "../storage/collection";
import type { DefinitionAdoptionRequest } from "../storage/local-type-pack";

export type DefinitionReview =
  | { kind: "adoption"; request: DefinitionAdoptionRequest }
  | { kind: "managed-upgrade"; request: ManagedTypeUpgradeRequest };

export function DefinitionReviewDialog({
  review,
  decide,
}: {
  review: DefinitionReview;
  decide(approved: boolean): void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const adoption = review.kind === "adoption" ? review.request : null;
  const files =
    review.kind === "adoption"
      ? review.request.resources.map(({ path }) => path)
      : [review.request.typePath];

  useEffect(() => {
    const dialog = dialogRef.current;
    const initial =
      dialog?.querySelector<HTMLButtonElement>("[data-safe-action]");
    initial?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        decide(false);
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const controls = [
        ...dialog.querySelectorAll<HTMLElement>(
          "button:not([disabled]), summary, [href], [tabindex]:not([tabindex='-1'])",
        ),
      ];
      if (!controls.length) return;
      const first = controls[0]!;
      const last = controls.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [decide]);

  const title = adoption
    ? "Let TaskNotes manage these definitions?"
    : "Update the TaskNotes task definition?";
  const action = adoption ? "Adopt and update" : "Update definition";

  return (
    <div className="definition-review-layer">
      <button
        aria-hidden="true"
        className="definition-review-scrim"
        tabIndex={-1}
        type="button"
        onClick={() => decide(false)}
      />
      <section
        aria-describedby="definition-review-summary"
        aria-labelledby="definition-review-title"
        aria-modal="true"
        className="definition-review-dialog"
        ref={dialogRef}
        role="alertdialog"
      >
        <div className="definition-review-heading">
          <span aria-hidden="true">
            <ShieldCheck size={20} />
          </span>
          <h2 id="definition-review-title">{title}</h2>
        </div>
        <p id="definition-review-summary">{review.request.message}</p>
        <div
          className="definition-review-files"
          aria-label="Definitions affected"
        >
          {files.map((path) => (
            <div key={path}>
              <FileKey2 aria-hidden="true" size={17} />
              <code>{path}</code>
            </div>
          ))}
        </div>
        {adoption ? (
          <details className="definition-review-explanation">
            <summary>What “manage” means</summary>
            <p>
              TaskNotes will replace the reviewed older definitions now and
              record their exact source, version, and digest in{" "}
              <code>mdbase.lock.yaml</code>. Later upgrades proceed only while
              those managed files still match that receipt; TaskNotes never
              overwrites an unexpected edit.
            </p>
          </details>
        ) : null}
        <div className="definition-review-actions">
          <button
            className="text-action"
            data-safe-action
            type="button"
            onClick={() => decide(false)}
          >
            Not now
          </button>
          <button
            className="outline-action"
            type="button"
            onClick={() => decide(true)}
          >
            {action}
          </button>
        </div>
      </section>
    </div>
  );
}
