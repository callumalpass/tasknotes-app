import { createContext, useContext, useEffect } from "react";
import type {
  RecordWriteStatus,
  RecordWriteTarget,
} from "../application/ports/task-repository";

export type RecordWriteEntry = {
  target: RecordWriteTarget;
  state: RecordWriteStatus;
};
export type RegisterWriteStatus = (entry: RecordWriteEntry) => () => void;
export const WriteStatusContext = createContext<RegisterWriteStatus | null>(
  null,
);

export function useRegisterWriteStatus(
  target: RecordWriteTarget,
  state: RecordWriteStatus | undefined,
) {
  const register = useContext(WriteStatusContext);
  const kind = target.kind;
  const key = target.kind === "source" ? target.path : target.id;
  useEffect(() => {
    if (!register || !state) return;
    return register({
      state,
      target: kind === "source" ? { kind, path: key } : { kind, id: key },
    });
  }, [register, kind, key, state]);
  return register !== null;
}

const REVIEW_EVENT = "tasknotes:review-record-write";
type ReviewEvent = CustomEvent<RecordWriteTarget>;

/** Ask an open editor to present its own resolution for a record's save.
 * Returns true when one did, so callers need not navigate to it again. */
export function requestRecordWriteReview(target: RecordWriteTarget): boolean {
  const event: ReviewEvent = new CustomEvent(REVIEW_EVENT, {
    detail: target,
    cancelable: true,
  });
  return !window.dispatchEvent(event);
}

/** An open editor handles review requests for its record while `active`. */
export function useRecordWriteReview(
  target: RecordWriteTarget,
  active: boolean,
  onReview: () => void,
) {
  const kind = target.kind;
  const key = target.kind === "source" ? target.path : target.id;
  useEffect(() => {
    if (!active) return;
    const listener = (event: Event) => {
      const detail = (event as ReviewEvent).detail;
      const detailKey = detail.kind === "source" ? detail.path : detail.id;
      if (detail.kind !== kind || detailKey !== key) return;
      event.preventDefault();
      onReview();
    };
    window.addEventListener(REVIEW_EVENT, listener);
    return () => window.removeEventListener(REVIEW_EVENT, listener);
  }, [active, kind, key, onReview]);
}
