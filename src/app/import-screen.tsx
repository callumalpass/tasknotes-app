import { Trans, useLingui } from "@lingui/react/macro";
import { Capacitor } from "@capacitor/core";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  makePlan,
  markdown,
  modelFor,
  type DestinationType,
  type ImportOptions,
  type PlannedTask,
} from "tasknotes-import/plan";
import type {
  ImportReport,
  TaskRepository,
} from "tasknotes-import/task-repository";
import type { SourceData } from "tasknotes-import/todoist";
import { connectTodoist } from "../cloud/todoist-authorization";
import { clearTodoistReturn, todoistReturn } from "../cloud/todoist-return";
import { useCollectionGate } from "./collection-context";
import { useHistoryLeaveGuard } from "./use-workspace-navigation";
import "./import-screen.css";

export function ImportScreen() {
  const { t } = useLingui();
  const { importDestination: destination } = useCollectionGate();
  const [repository, setRepository] = useState<TaskRepository>();
  const [types, setTypes] = useState<DestinationType[]>([]);
  const [targetName, setTargetName] = useState("");
  const [source, setSource] = useState<SourceData>();
  const [selected, setSelected] = useState(new Set<string>());
  const [options, setOptions] = useState<ImportOptions>({
    folder: "tasks",
    dateTarget: "scheduled",
    priorities: {},
  });
  const [plan, setPlan] = useState<PlannedTask[]>([]);
  const [report, setReport] = useState<ImportReport[]>([]);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(false);
  const cancel = useRef<AbortController | null>(null);
  const sourceLoaded = useRef(false);
  const target = types.find((entry) => entry.name === targetName);
  const model = useMemo(
    () => (target ? modelFor(target) : undefined),
    [target],
  );
  const uncertain = report.some((entry) => entry.status === "uncertain");
  const native = Capacitor.isNativePlatform();

  useHistoryLeaveGuard(importing, () =>
    setError(t`Stop after the current task before leaving.`),
  );

  useEffect(() => {
    if (!destination || native) return;
    let current = true;
    void destination
      .repository()
      .then(async (opened) => {
        const discovered = await opened.discoverTypes();
        if (!current || !opened.isCurrent()) return;
        setRepository(opened);
        setTypes(discovered);
        if (discovered.length === 1) setTargetName(discovered[0].name);
      })
      .catch((problem: unknown) => {
        if (current)
          setError(
            problem instanceof Error
              ? problem.message
              : t`Collection access is unavailable.`,
          );
      });
    return () => {
      current = false;
    };
  }, [destination, native, t]);

  useEffect(() => {
    if (sourceLoaded.current) return;
    let current = true;
    void todoistReturn().then((returned) => {
      if (!current || !returned) return;
      sourceLoaded.current = true;
      if ("error" in returned)
        setError(
          returned.error instanceof Error
            ? returned.error.message
            : t`Could not load Todoist tasks.`,
        );
      else {
        setSource(returned.source);
        setSelected(new Set(returned.source.tasks.map((task) => task.id)));
      }
    });
    return () => {
      current = false;
    };
  }, [t]);

  useEffect(() => () => cancel.current?.abort(), []);

  useEffect(() => {
    if (!importing) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [importing]);

  function invalidate() {
    setPlan([]);
    setReport([]);
    setAccepted(false);
  }

  async function action(work: () => Promise<void>) {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (problem) {
      setError(
        problem instanceof Error
          ? problem.message
          : t`Import could not continue.`,
      );
    } finally {
      active.current = false;
      setBusy(false);
    }
  }

  async function importTasks() {
    if (
      !repository ||
      !target ||
      !accepted ||
      !plan.length ||
      plan.some((task) => task.errors.length) ||
      uncertain
    )
      throw new Error(t`Review the import before continuing.`);
    setAccepted(false);
    setImporting(true);
    cancel.current = new AbortController();
    try {
      const fresh = (await repository.discoverTypes()).find(
        (entry) => entry.name === target.name,
      );
      if (
        !repository.isCurrent() ||
        JSON.stringify(fresh) !== JSON.stringify(target)
      ) {
        invalidate();
        throw new Error(t`Destination changed. Preview the import again.`);
      }
      await repository.importTasks(plan, setReport, cancel.current.signal);
    } finally {
      setImporting(false);
    }
  }

  function downloadReport() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "todoist-import-report.json";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const statuses = {
    created: t`Created`,
    skipped: t`Skipped`,
    failed: t`Failed`,
    uncertain: t`Uncertain`,
    "not-started": t`Not started`,
  };

  return (
    <section className="screen import-screen" aria-labelledby="import-title">
      <header className="screen-header">
        <h1 id="import-title">
          <Trans>Import from Todoist</Trans>
        </h1>
      </header>
      {native ? (
        <p>
          <a href="https://app.tasknotes.dev/import">
            <Trans>Import from Todoist in the web app.</Trans>
          </a>
        </p>
      ) : (
        <>
          <p>
            <Trans>
              Tasks stay unchanged in Todoist. Imports only create new records.
            </Trans>
          </p>
          {destination ? (
            <p>
              <Trans>Destination: {destination.name}</Trans>
            </p>
          ) : (
            <p>
              <Trans>Choose a connected collection before importing.</Trans>
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          {busy && (
            <p role="status">
              <Trans>Working…</Trans>
            </p>
          )}
          <fieldset disabled={busy || uncertain}>
            {!source ? (
              <button
                className="secondary-action"
                type="button"
                onClick={() => void action(connectTodoist)}
              >
                <Trans>Connect Todoist</Trans>
              </button>
            ) : (
              <>
                <button
                  className="secondary-action"
                  type="button"
                  onClick={() => {
                    clearTodoistReturn();
                    setSource(undefined);
                    setSelected(new Set());
                    invalidate();
                  }}
                >
                  <Trans>Clear loaded Todoist data</Trans>
                </button>
                <div className="import-task-actions">
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={() => {
                      invalidate();
                      setSelected(new Set(source.tasks.map((task) => task.id)));
                    }}
                  >
                    <Trans>Select all</Trans>
                  </button>
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={() => {
                      invalidate();
                      setSelected(new Set());
                    }}
                  >
                    <Trans>Clear selection</Trans>
                  </button>
                </div>
                <div className="import-tasks">
                  {source.tasks.map((task) => (
                    <label key={task.id}>
                      <input
                        type="checkbox"
                        checked={selected.has(task.id)}
                        onChange={(event) => {
                          invalidate();
                          const next = new Set(selected);
                          if (event.target.checked) next.add(task.id);
                          else next.delete(task.id);
                          setSelected(next);
                        }}
                      />
                      {task.content}
                    </label>
                  ))}
                </div>
              </>
            )}
            <label>
              <Trans>Task type</Trans>
              <select
                value={targetName}
                onChange={(event) => {
                  invalidate();
                  setTargetName(event.target.value);
                  setOptions({ ...options, priorities: {} });
                }}
              >
                <option value="">{t`Choose…`}</option>
                {types.map((entry) => (
                  <option key={entry.name} value={entry.name}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <Trans>Import folder</Trans>
              <input
                value={options.folder}
                onChange={(event) => {
                  invalidate();
                  setOptions({ ...options, folder: event.target.value });
                }}
              />
            </label>
            <label>
              <Trans>Todoist task dates</Trans>
              <select
                value={options.dateTarget}
                onChange={(event) => {
                  invalidate();
                  setOptions({
                    ...options,
                    dateTarget: event.target
                      .value as ImportOptions["dateTarget"],
                  });
                }}
              >
                <option value="scheduled">{t`Scheduled date`}</option>
                <option value="due">{t`Due date`}</option>
              </select>
            </label>
            <p>
              <Trans>Deadlines become due dates.</Trans>
            </p>
            <div className="import-priorities">
              {[1, 2, 3, 4].map((priority) => (
                <label key={priority}>
                  <Trans>Todoist API priority {priority}</Trans>
                  <select
                    value={options.priorities[priority] ?? ""}
                    onChange={(event) => {
                      invalidate();
                      setOptions({
                        ...options,
                        priorities: {
                          ...options.priorities,
                          [priority]: event.target.value,
                        },
                      });
                    }}
                  >
                    <option value="">{t`Choose…`}</option>
                    {model?.priorities.map((entry) => (
                      <option key={entry.value} value={entry.value}>
                        {entry.label || entry.value}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <button
              className="secondary-action"
              type="button"
              disabled={!source || !repository || !target || !selected.size}
              onClick={() =>
                void action(async () => {
                  if (!source || !target) return;
                  setAccepted(false);
                  setReport([]);
                  setPlan(await makePlan(source, selected, target, options));
                })
              }
            >
              <Trans>Preview import</Trans>
            </button>
          </fieldset>
          {plan.length > 0 && (
            <section aria-label={t`Review import`}>
              <ul className="import-preview">
                {plan.map((task) => (
                  <li key={task.sourceId}>
                    <strong>{task.title}</strong>
                    <code>{task.path}</code>
                    {[...task.errors, ...task.warnings].map(
                      (message, index) => (
                        <p key={index}>{message}</p>
                      ),
                    )}
                    <details>
                      <summary>
                        <Trans>Markdown preview</Trans>
                      </summary>
                      <pre>{markdown(task)}</pre>
                    </details>
                  </li>
                ))}
              </ul>
              <label>
                <input
                  type="checkbox"
                  disabled={busy || uncertain}
                  checked={accepted}
                  onChange={(event) => setAccepted(event.target.checked)}
                />
                <Trans>I reviewed these tasks and the destination.</Trans>
              </label>
              <button
                className="primary-action"
                type="button"
                disabled={
                  busy ||
                  uncertain ||
                  !accepted ||
                  plan.some((task) => task.errors.length > 0)
                }
                onClick={() => void action(importTasks)}
              >
                <Trans>Import selected tasks</Trans>
              </button>
            </section>
          )}
          {importing && (
            <button
              className="secondary-action"
              type="button"
              onClick={() => cancel.current?.abort()}
            >
              <Trans>Stop after the current task</Trans>
            </button>
          )}
          {report.length > 0 && (
            <section aria-label={t`Import report`}>
              <ul>
                {report.map((entry) => (
                  <li key={entry.sourceId}>
                    <code>{entry.path}</code> — {statuses[entry.status]}
                    {entry.message && <p>{entry.message}</p>}
                  </li>
                ))}
              </ul>
              <button
                className="secondary-action"
                type="button"
                onClick={downloadReport}
              >
                <Trans>Download report</Trans>
              </button>
              {uncertain && (
                <button
                  className="secondary-action"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      if (!repository?.isCurrent())
                        throw new Error(
                          t`Destination changed. Preview the import again.`,
                        );
                      const mutationIds = report.flatMap((entry) =>
                        entry.status === "uncertain" && entry.mutationId
                          ? [entry.mutationId]
                          : [],
                      );
                      await repository.recoverWrites(
                        mutationIds,
                        plan,
                        report,
                        setReport,
                      );
                    })
                  }
                >
                  <Trans>Recover original writes</Trans>
                </button>
              )}
            </section>
          )}
        </>
      )}
    </section>
  );
}
