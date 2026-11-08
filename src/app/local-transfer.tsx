import { useEffect, useMemo, useRef, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { resolveTaskCollectionConfiguration } from "../domain/task-configuration";
import type { TaskRepository } from "../application/ports/task-repository";
import type { TaskImportTarget } from "../application/ports/task-import";
import {
  suggestTransferPlan,
  pendingTransferSource,
  prepareTransfer,
  executeTransfer,
  type TaskTransferPlan,
} from "../application/local-transfer";
import {
  LocalTaskRepository,
  type TransferLedger,
} from "../storage/local-task-repository";
import type { CollectionSnapshot } from "../storage/snapshot-task-repository";
import { useOverlay } from "../components/overlays/use-overlay";

export function LocalTransferDialog({
  local,
  destination,
  onClose,
}: {
  local: LocalTaskRepository;
  destination: TaskRepository;
  onClose(): void;
}) {
  const { t } = useLingui();
  const rootRef = useRef<HTMLElement>(null);
  const [source, setSource] = useState<CollectionSnapshot>();
  const [targets, setTargets] = useState<TaskImportTarget[]>([]);
  const [plan, setPlan] = useState<TaskTransferPlan>();
  const [ledger, setLedger] = useState<TransferLedger>();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<unknown>();
  const [, redraw] = useState(0);
  useOverlay({
    open: true,
    rootRef,
    modal: true,
    onDismiss: () => {
      if (!busy) onClose();
    },
  });
  useEffect(() => {
    let active = true;
    void (async () => {
      const info = await destination.collectionInfo();
      if (!info.id || !destination.imports)
        throw new Error("import_unavailable");
      const [snapshot, choices, previous, history] = await Promise.all([
        local.exportSnapshot(),
        destination.imports.targets(),
        local.transfer(info.id),
        local.transferHistory(info.id),
      ]);
      if (!active) return;
      const pending = pendingTransferSource(snapshot, history);
      setSource(previous?.source ?? pending);
      setTargets(choices);
      if (previous) {
        setLedger(previous);
        setPlan(previous.plan);
      } else if (choices.length === 1)
        setPlan(suggestTransferPlan(pending, choices[0]!));
    })().catch((error: unknown) => {
      if (active) setProblem(error);
    });
    return () => {
      active = false;
    };
  }, [destination, local]);
  const run = async () => {
    if (!plan || !source || !destination.imports || busy) return;
    setBusy(true);
    setProblem(undefined);
    try {
      const info = await destination.collectionInfo();
      await local.exclusiveTransfer(info.id!, async () => {
        const previous = await local.transfer(info.id!);
        const history = await local.transferHistory(info.id!);
        const pending = pendingTransferSource(source, history);
        const next =
          previous ??
          (await prepareTransfer(
            pending,
            info.id!,
            plan,
            destination.imports!,
            history,
          ));
        // No destination mutation occurs until the complete payload is checkpointed.
        await local.saveTransfer(next);
        setLedger(next);
        await executeTransfer(
          next,
          destination.imports!,
          destination.files,
          (state) => local.saveTransfer(state),
          () => redraw((value) => value + 1),
        );
      });
    } catch (error) {
      setProblem(error);
    } finally {
      setBusy(false);
    }
  };
  const sourceConfiguration = useMemo(
    () =>
      source
        ? resolveTaskCollectionConfiguration(
            source.modelDefinition,
            source.settingsRecord ? { settings: source.settingsRecord } : {},
          )
        : undefined,
    [source],
  );
  const inputRequired =
    plan &&
    source &&
    (source.tasks.some(
      (task) => !plan.statuses[task.status] || !plan.priorities[task.priority],
    ) ||
      plan.target.configuration.userFields.some(
        (field) =>
          !field.readOnly &&
          field.required &&
          field.defaultValue === undefined &&
          source.tasks.some(
            (task) => task.customProperties[field.key] === undefined,
          ) &&
          plan.customValues[field.key] === undefined,
      ));
  return (
    <div className="recurring-scope-layer">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="local-transfer-title"
        className="recurring-scope-dialog local-transfer-dialog"
        ref={rootRef}
      >
        <h2 id="local-transfer-title">
          <Trans>Bring local work into this collection</Trans>
        </h2>
        <p>
          <Trans>
            Type definitions and collection settings stay as they are. Local
            work is kept for recovery. Previously imported tasks and notes stay
            independent; later local edits are not synchronized.
          </Trans>
        </p>
        {source ? (
          <p>{t`Tasks: ${source.tasks.length}. Notes: ${source.scratchpads.filter((note) => note.body.trim() || note.title?.trim()).length}. Files: ${source.files.length}.`}</p>
        ) : null}
        {source && !ledger ? (
          <fieldset disabled={busy}>
            <label>
              <Trans>Task type</Trans>
              <select
                value={plan?.target.typeName ?? ""}
                onChange={(event) => {
                  const target = targets.find(
                    (item) => item.typeName === event.target.value,
                  );
                  setPlan(
                    target ? suggestTransferPlan(source, target) : undefined,
                  );
                }}
              >
                <option value="">{t({ message: "Choose a value" })}</option>
                {targets.map((target) => (
                  <option key={target.typeName} value={target.typeName}>
                    {target.typeName}
                  </option>
                ))}
              </select>
            </label>
            {plan ? (
              <>
                {[...new Set(source.tasks.map((task) => task.status))].map(
                  (status) => (
                    <label key={`status:${status}`}>
                      <span>
                        <Trans>Status</Trans>: {status}
                      </span>
                      <select
                        value={plan.statuses[status] ?? ""}
                        onChange={(event) =>
                          setPlan({
                            ...plan,
                            statuses: {
                              ...plan.statuses,
                              [status]: event.target.value,
                            },
                          })
                        }
                      >
                        <option value="">
                          {t({ message: "Choose a value" })}
                        </option>
                        {plan.target.configuration.statuses
                          .filter((choice) => {
                            const original = sourceConfiguration?.statuses.find(
                              (item) => item.value === status,
                            );
                            return (
                              !!choice.isCompleted ===
                                !!original?.isCompleted &&
                              !!choice.isSkipped === !!original?.isSkipped
                            );
                          })
                          .map((choice) => (
                            <option key={choice.value} value={choice.value}>
                              {choice.label}
                            </option>
                          ))}
                      </select>
                    </label>
                  ),
                )}
                {[...new Set(source.tasks.map((task) => task.priority))].map(
                  (priority) => (
                    <label key={`priority:${priority}`}>
                      <span>
                        <Trans>Priority</Trans>: {priority}
                      </span>
                      <select
                        value={plan.priorities[priority] ?? ""}
                        onChange={(event) =>
                          setPlan({
                            ...plan,
                            priorities: {
                              ...plan.priorities,
                              [priority]: event.target.value,
                            },
                          })
                        }
                      >
                        <option value="">
                          {t({ message: "Choose a value" })}
                        </option>
                        {plan.target.configuration.priorities.map((choice) => (
                          <option key={choice.value} value={choice.value}>
                            {choice.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ),
                )}
                {plan.target.configuration.userFields
                  .filter((field) => !field.readOnly)
                  .map((field) => (
                    <label key={field.key}>
                      <span>
                        {field.displayName}
                        {field.required ? " *" : ""}
                      </span>
                      {field.type === "boolean" ? (
                        <select
                          value={
                            plan.customValues[field.key] === undefined
                              ? ""
                              : String(plan.customValues[field.key])
                          }
                          onChange={(event) =>
                            setPlan({
                              ...plan,
                              customValues: {
                                ...plan.customValues,
                                [field.key]:
                                  event.target.value === ""
                                    ? undefined
                                    : event.target.value === "true",
                              },
                            })
                          }
                        >
                          <option value="">
                            {t({ message: "Choose a value" })}
                          </option>
                          <option value="true">{t({ message: "Yes" })}</option>
                          <option value="false">{t({ message: "No" })}</option>
                        </select>
                      ) : field.options ? (
                        <select
                          value={String(plan.customValues[field.key] ?? "")}
                          onChange={(event) =>
                            setPlan({
                              ...plan,
                              customValues: {
                                ...plan.customValues,
                                [field.key]: event.target.value || undefined,
                              },
                            })
                          }
                        >
                          <option value="">
                            {t({ message: "Choose a value" })}
                          </option>
                          {field.options.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label ?? option.value}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          aria-label={field.displayName}
                          type={field.type === "number" ? "number" : "text"}
                          placeholder={t({
                            message: "Value for imported tasks",
                          })}
                          value={String(plan.customValues[field.key] ?? "")}
                          onChange={(event) => {
                            const value = event.target.value;
                            setPlan({
                              ...plan,
                              customValues: {
                                ...plan.customValues,
                                [field.key]: !value
                                  ? undefined
                                  : field.type === "number"
                                    ? Number(value)
                                    : field.type === "boolean"
                                      ? value === "true"
                                      : field.type === "list"
                                        ? value
                                            .split(",")
                                            .map((item) => item.trim())
                                        : value,
                              },
                            });
                          }}
                        />
                      )}
                    </label>
                  ))}
              </>
            ) : null}
          </fieldset>
        ) : null}
        {ledger ? (
          <p role="status">
            {ledger.completed
              ? t({
                  message:
                    "Transfer complete. Your local copy is still available.",
                })
              : `${Object.values(ledger.records).filter((record) => record.confirmed).length} / ${ledger.prepared.length}`}
          </p>
        ) : null}
        {problem ? (
          <div role="alert">
            <p>
              <Trans>
                Transfer paused. Your local work is safe. Check the original
                writes to continue.
              </Trans>
            </p>
            <details>
              <summary>
                <Trans>Transfer details</Trans>
              </summary>
              <code>
                {problem instanceof Error ? problem.message : String(problem)}
              </code>
            </details>
          </div>
        ) : null}
        <div className="recurring-scope-actions">
          <button
            className="secondary-action"
            disabled={busy}
            onClick={onClose}
          >
            <Trans>Close</Trans>
          </button>
          {!ledger?.completed ? (
            <button
              className="primary-action"
              disabled={
                busy ||
                !plan ||
                !!inputRequired ||
                !source ||
                !(
                  source.tasks.length ||
                  source.files.length ||
                  source.scratchImages.length ||
                  source.scratchpads.some(
                    (note) => note.body.trim() || note.title?.trim(),
                  )
                )
              }
              onClick={() => void run()}
            >
              {busy
                ? t({ message: "Preparing transfer" })
                : ledger
                  ? t({ message: "Check transfer" })
                  : t({ message: "Transfer work" })}
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
