import { useLingui } from "@lingui/react/macro";
import { useRef } from "react";
import type { CalendarSeriesEffect } from "@tasknotes/model/calendar";
import { useOverlay } from "./overlays/use-overlay";

export type RecurringEditScope = "occurrence" | "series";

export interface RecurringEditScopeRequest {
  title: string;
  /** Formatted date of the occurrence being changed. */
  date: string;
  series?: CalendarSeriesEffect;
}

/** Asks whether a calendar gesture on a recurring occurrence changes it alone or the series. */
export function RecurringEditScopeDialog({
  request,
  onChoose,
}: {
  request: RecurringEditScopeRequest;
  onChoose(scope: RecurringEditScope | null): void;
}) {
  const { t } = useLingui();
  const rootRef = useRef<HTMLElement>(null);
  const occurrenceRef = useRef<HTMLButtonElement>(null);
  useOverlay({
    open: true,
    rootRef,
    modal: true,
    onDismiss: () => onChoose(null),
    initialFocus: () => occurrenceRef.current,
  });
  const { title, date, series } = request;
  const seriesLabel =
    series === "time"
      ? t({ message: "Change the time of every occurrence" })
      : series === "all-day"
        ? t({ message: "Make every occurrence all-day" })
        : series === "timed"
          ? t({ message: "Give every occurrence this time" })
          : series === "duration"
            ? t({ message: "Change the duration of every occurrence" })
            : undefined;
  return (
    <div className="recurring-scope-layer">
      <button
        aria-label={t({ message: "Cancel" })}
        className="recurring-scope-scrim"
        tabIndex={-1}
        type="button"
        onClick={() => onChoose(null)}
      />
      <section
        aria-describedby="recurring-scope-message"
        aria-labelledby="recurring-scope-title"
        className="recurring-scope-dialog"
        ref={rootRef}
        role="alertdialog"
      >
        <h2 id="recurring-scope-title">
          {t({ message: "Change a recurring task" })}
        </h2>
        <p id="recurring-scope-message">
          {t`“${title}” repeats. Changing only this occurrence creates an occurrence note for ${date}.`}
        </p>
        {seriesLabel ? null : (
          <p>
            {t({
              message:
                "The series keeps its days, so only this occurrence can move to another day.",
            })}
          </p>
        )}
        <div>
          <button
            className="text-action"
            type="button"
            onClick={() => onChoose(null)}
          >
            {t({ message: "Cancel" })}
          </button>
          {seriesLabel ? (
            <button
              className="text-action"
              type="button"
              onClick={() => onChoose("series")}
            >
              {seriesLabel}
            </button>
          ) : null}
          <button
            className="primary-action"
            ref={occurrenceRef}
            type="button"
            onClick={() => onChoose("occurrence")}
          >
            {t({ message: "This occurrence" })}
          </button>
        </div>
      </section>
    </div>
  );
}
