import { useEffect, useMemo, useRef, useState } from "react";
import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { resolveTaskCollectionConfiguration } from "../domain/task-configuration";
import type { TaskRepository } from "../application/ports/task-repository";
import type { TaskImportTarget } from "../application/ports/task-import";
import {
  suggestTransferPlan,
  pendingTransferSource,
  hasTransferWork,
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
  const rootRef = useRef<HTMLDivElement>(null);
  const [source, setSource] = useState<CollectionSnapshot>();
  const [targets, setTargets] = useState<TaskImportTarget[]>([]);
  const [plan, setPlan] = useState<TaskTransferPlan>();
  const [ledger, setLedger] = useState<TransferLedger>();
  const [importedBefore, setImportedBefore] = useState(false);
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
      setImportedBefore(history.length > 0);
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
  const noteCount =
    source?.scratchpads.filter((note) => note.body.trim() || note.title?.trim())
      .length ?? 0;
  const summary = source
    ? [
        source.tasks.length
          ? plural(source.tasks.length, { one: "# task", other: "# tasks" })
          : "",
        noteCount
          ? plural(noteCount, {
              one: "# Scratchpad note",
              other: "# Scratchpad notes",
            })
          : "",
        source.files.length
          ? plural(source.files.length, { one: "# file", other: "# files" })
          : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  const nothingToImport = !!source && !ledger && !hasTransferWork(source);
  const waiting = !!source && (nothingToImport || !plan || !!inputRequired);
  const confirmed = ledger
    ? [...Object.values(ledger.records), ...Object.values(ledger.files)].filter(
        (item) => item.confirmed,
      ).length
    : 0;
  const total = ledger
    ? ledger.prepared.length + Object.keys(ledger.files).length
    : 0;
  return (
    <div className="recurring-scope-layer" ref={rootRef}>
      {/* Outside clicks never discard a reviewed mapping; Close and Escape do. */}
      <div aria-hidden="true" className="recurring-scope-scrim" />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="local-transfer-title"
        aria-describedby="local-transfer-description"
        className="recurring-scope-dialog local-transfer-dialog"
      >
        <h2 id="local-transfer-title">
          <Trans>Bring local work into this collection</Trans>
        </h2>
        <p id="local-transfer-description">
          <Trans>
            Your local tasks, Scratchpad notes and files are copied in as new
            items. This collection’s task types and settings don’t change. Your
            local copy stays separate and can be opened from Collection
            settings.
          </Trans>
        </p>
        {importedBefore ? (
          <p>
            <Trans>
              Items imported before aren’t copied again. Local items changed
              since then arrive as separate copies, so edits made in this
              collection are kept.
            </Trans>
          </p>
        ) : null}
        {summary ? <p className="local-transfer-summary">{summary}</p> : null}
        {source && !ledger && !nothingToImport ? (
          <fieldset disabled={busy}>
            <label className="form-field">
              <span>
                <Trans>Task type</Trans>
              </span>
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
                    <label className="form-field" key={`status:${status}`}>
                      <span>
                        <Trans>Status</Trans>:{" "}
                        {sourceConfiguration?.statuses.find(
                          (item) => item.value === status,
                        )?.label || status}
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
                    <label className="form-field" key={`priority:${priority}`}>
                      <span>
                        <Trans>Priority</Trans>:{" "}
                        {sourceConfiguration?.priorities.find(
                          (item) => item.value === priority,
                        )?.label || priority}
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
                    <label className="form-field" key={field.key}>
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
        {!ledger && waiting ? (
          <p className="local-transfer-hint">
            {nothingToImport
              ? t({ message: "There’s no new local work to bring in." })
              : t({ message: "Choose a value for each field to continue." })}
          </p>
        ) : null}
        {ledger ? (
          <div className="local-transfer-progress" role="status">
            {ledger.completed ? (
              <p>
                {t({
                  message:
                    "Transfer complete. Your local copy is still available.",
                })}
              </p>
            ) : (
              <>
                <p>{t`Copied ${confirmed} of ${total}`}</p>
                <progress
                  aria-hidden="true"
                  max={Math.max(total, 1)}
                  value={confirmed}
                />
              </>
            )}
          </div>
        ) : null}
        {problem ? (
          <section className="local-transfer-problem" role="alert">
            <p className="inline-error">
              <Trans>Transfer paused. Your local work is safe.</Trans>{" "}
              {ledger && !ledger.completed ? (
                <Trans>
                  Check transfer confirms what was already copied, then copies
                  the rest.
                </Trans>
              ) : null}
            </p>
            <details className="operation-error-details">
              <summary>
                <Trans>Transfer details</Trans>
              </summary>
              <p>
                {problem instanceof Error ? problem.message : String(problem)}
              </p>
            </details>
          </section>
        ) : null}
        <div className="recurring-scope-actions">
          {ledger?.completed || nothingToImport ? null : (
            <button
              className="secondary-action"
              disabled={busy}
              type="button"
              onClick={onClose}
            >
              <Trans>Close</Trans>
            </button>
          )}
          {/* One persistent primary button keeps keyboard focus through every state. */}
          <button
            className={nothingToImport ? "secondary-action" : "primary-action"}
            disabled={
              !ledger?.completed &&
              !nothingToImport &&
              (!plan || !!inputRequired || !source)
            }
            aria-disabled={busy || undefined}
            type="button"
            onClick={() => {
              if (busy) return;
              if (ledger?.completed || nothingToImport) onClose();
              else void run();
            }}
          >
            {ledger?.completed
              ? t({ message: "Done" })
              : nothingToImport
                ? t({ message: "Close" })
                : busy
                  ? t({ message: "Preparing transfer" })
                  : ledger
                    ? t({ message: "Check transfer" })
                    : t({ message: "Transfer work" })}
          </button>
        </div>
      </section>
    </div>
  );
}
