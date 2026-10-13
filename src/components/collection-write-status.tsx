import { CloudUpload, TriangleAlert } from "lucide-react";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type {
  RecordWriteTarget,
  RepositoryConnectionStatus,
  TaskRepository,
} from "../application/ports/task-repository";

import {
  ConnectionNoticeContext,
  connectionNoticeLabels,
  type ConnectionNotice,
} from "../app/connection-notice";
import {
  WriteStatusContext,
  type RecordWriteEntry as Entry,
  type RegisterWriteStatus as Register,
} from "./record-write-status-context";
const keyFor = (target: RecordWriteTarget) =>
  JSON.stringify([
    target.kind,
    target.kind === "source" ? target.path : target.id,
  ]);

/** Presentation-only registry of known record outcomes. It observes existing
 * read-only write metadata and pending counts, never retrying a submission. */
export function CollectionWriteStatus({
  repository,
  connection,
  onReview,
  children,
}: {
  repository: TaskRepository;
  connection: RepositoryConnectionStatus;
  onReview(target: RecordWriteTarget): void;
  children: ReactNode;
}) {
  const [observed, setObserved] = useState({
    repository,
    entries: new Map<string, Entry>(),
  });
  const register = useCallback<Register>(
    (entry) => {
      setObserved((previous) => ({
        repository,
        entries: new Map(
          previous.repository === repository ? previous.entries : [],
        ).set(keyFor(entry.target), entry),
      }));
      // Keep a known outcome if its row is filtered out or navigation changes.
      // The read-only metadata subscription below retires it after confirmation.
      return () => {};
    },
    [repository],
  );
  useEffect(
    () =>
      repository.subscribe(() => {
        setObserved((previous) => {
          if (previous.repository !== repository) return previous;
          const next = new Map<string, Entry>();
          let changed = false;
          for (const [key, entry] of previous.entries) {
            const state = repository.writeState?.(entry.target);
            if (state) next.set(key, { target: entry.target, state });
            if (state !== entry.state) changed = true;
          }
          return changed ? { repository, entries: next } : previous;
        });
      }),
    [repository],
  );
  const unique = useMemo(
    () =>
      observed.repository === repository ? [...observed.entries.values()] : [],
    [observed, repository],
  );
  const pending = Math.max(
    connection.sync?.pending ?? 0,
    unique.filter((entry) => entry.state === "pending").length,
  );
  const problems = unique.filter((entry) => entry.state !== "pending");
  const notice = useContext(ConnectionNoticeContext);
  return (
    <WriteStatusContext.Provider value={register}>
      {children}
      <WriteStatusOverlay
        repository={repository}
        pending={pending}
        disconnected={
          connection.state === "unavailable" ||
          connection.savedOnDevice === true
        }
        notice={notice}
        problem={problems[0]}
        problemCount={problems.length}
        onReview={onReview}
      />
    </WriteStatusContext.Provider>
  );
}

function useProlonged(
  repository: TaskRepository,
  active: boolean,
  delay: number,
) {
  const [expiredFor, setExpiredFor] = useState<TaskRepository>();
  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => setExpiredFor(repository), delay);
    return () => {
      window.clearTimeout(timer);
      setExpiredFor(undefined);
    };
  }, [active, delay, repository]);
  return active && expiredFor === repository;
}

/** A single overlay, never a row or header inserted into document flow. */
export function WriteStatusOverlay({
  repository,
  pending,
  disconnected: reportedDisconnected = false,
  notice = null,
  problem,
  problemCount = problem ? 1 : 0,
  onReview,
}: {
  repository: TaskRepository;
  pending: number;
  disconnected?: boolean;
  /** The SDK's offline, reconnecting or saved-on-device state, shown at once. */
  notice?: ConnectionNotice | null;
  problem?: Entry;
  problemCount?: number;
  onReview?(target: RecordWriteTarget): void;
}) {
  const disconnected = reportedDisconnected || notice !== null;
  const syncing = useProlonged(repository, pending > 0, 2_000);
  // Only time spent connected counts as slow: changes kept while offline
  // start syncing on reconnect and usually finish within moments.
  const slow = useProlonged(repository, pending > 0 && !disconnected, 30_000);
  const offline = useProlonged(repository, pending > 0 && disconnected, 5_000);
  const message = problem
    ? problem.state === "failed"
      ? "Change rejected"
      : problem.state === "conflicted"
        ? "Conflicting changes"
        : "Save outcome unknown"
    : notice
      ? connectionNoticeLabels[notice]
      : offline
        ? "Saved on this device; waiting for sync"
        : slow
          ? "Sync is taking longer than usual"
          : syncing
            ? "Syncing…"
            : "";
  const needsAttention = Boolean(
    problem || (notice && notice !== "reconnecting") || offline || slow,
  );
  return createPortal(
    <div
      className={`collection-write-status${message ? " is-visible" : ""}${needsAttention ? " needs-attention" : ""}`}
      aria-hidden={!message}
      role={needsAttention ? "status" : undefined}
      aria-live={needsAttention ? "polite" : "off"}
      aria-atomic="true"
      data-testid="collection-write-status"
    >
      {needsAttention ? (
        <TriangleAlert aria-hidden="true" size={16} />
      ) : (
        <CloudUpload aria-hidden="true" size={16} />
      )}
      <span>{message}</span>
      {problemCount > 1 ? (
        <span>{problemCount} changes need review</span>
      ) : null}
      {problem && onReview ? (
        <button type="button" onClick={() => onReview(problem.target)}>
          Review record
        </button>
      ) : null}
    </div>,
    document.body,
  );
}
