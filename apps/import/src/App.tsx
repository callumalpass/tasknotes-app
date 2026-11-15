import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { TodoistApi, type SourceData } from "./todoist";
import { authorizeTodoist, assertOrigin } from "./oauth";
import { session, taskRepository } from "./connect";
import { describeError, type MdbaseSetupPlan } from "@mdbase-dev/sdk";
import {
  makePlan,
  markdown,
  modelFor,
  type DestinationType,
  type PlannedTask,
  type ImportOptions,
} from "./plan";
import type { ImportReport } from "./task-repository";
import { exampleSource, exampleTarget } from "./example";
import { ThemeSelector } from "./ThemeSelector";

export interface InitialState {
  source?: SourceData;
  error?: string;
}
function download(name: string, content: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function App({ initial }: { initial: InitialState }) {
  const snapshot = useSyncExternalStore(
    (l) => session.subscribe(l),
    () => session.getSnapshot(),
  );
  const phase = snapshot.phase;
  const connection = phase.kind === "ready" ? phase.connection : null;
  const repository = useMemo(
    () => (connection ? taskRepository(connection) : null),
    [connection],
  );
  const [setupPlan, setSetupPlan] = useState<MdbaseSetupPlan>();
  const [source, setSource] = useState(initial.source);
  const [demo, setDemo] = useState(false);
  const [selected, setSelected] = useState(
    new Set(initial.source?.tasks.map((t) => t.id)),
  );
  const [types, setTypes] = useState<DestinationType[]>([]);
  const [target, setTarget] = useState<DestinationType>();
  const [collectionName, setCollectionName] = useState("");
  const [options, setOptions] = useState<ImportOptions>({
    folder: "tasks",
    dateTarget: "scheduled",
    priorities: {},
  });
  const [plan, setPlan] = useState<PlannedTask[]>([]);
  const [previewId, setPreviewId] = useState("");
  const [error, setError] = useState(initial.error || "");
  const [busy, setBusy] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [report, setReport] = useState<ImportReport[]>([]);
  const [filter, setFilter] = useState("");
  const cancel = useRef<AbortController | null>(null);
  const working = useRef(false);
  const frozen = busy !== "";
  const blocked = plan.filter((t) => t.errors.length).length;
  const preview = plan.find((p) => p.sourceId === previewId) ?? plan[0];
  const model = target ? modelFor(target) : undefined;

  async function action(label: string, work: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(label);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Unexpected failure. Please try again.",
      );
    } finally {
      working.current = false;
      setBusy("");
    }
  }
  function chooseTarget(next: DestinationType) {
    setTarget(next);
    setPlan([]);
    setAccepted(false);
    setReport([]);
    // Explicit user choice prevents silently inverting API/UI priority numbering.
    const path = (next.definition.collection as { path?: unknown } | undefined)
      ?.path as { folder?: unknown } | undefined;
    setOptions((o) => ({
      ...o,
      priorities: {},
      folder: typeof path?.folder === "string" ? path.folder : "tasks",
    }));
  }
  function invalidate() {
    setPlan([]);
    setAccepted(false);
    setReport([]);
  }
  useEffect(() => {
    if (demo || phase.kind !== "ready") {
      if (!demo) {
        setTypes([]);
        setTarget(undefined);
        setPlan([]);
      }
      return;
    }
    let live = true;
    if (connection && repository)
      void repository
        .discoverTypes()
        .then((targets) => {
          if (!live || !repository.isCurrent()) return;
          setTypes(targets);
          setCollectionName(connection.displayName ?? connection.id);
          if (targets.length === 1) chooseTarget(targets[0]);
        })
        .catch((e) => {
          if (live)
            setError(
              describeError(e)?.message ??
                "Could not read the destination definitions. Reopen the collection and try again.",
            );
        });
    return () => {
      live = false;
    };
  }, [phase.kind, connection, repository, demo]);
  useEffect(() => {
    setSetupPlan(undefined);
    setReport([]);
    setAccepted(false);
  }, [snapshot.selectedCollectionId]);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (busy === "Importing") {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [busy]);

  async function beginDestination() {
    assertOrigin();
    setSetupPlan(undefined);
    if (phase.kind === "starting" || phase.kind === "signed_out")
      await session.signIn();
    else if (phase.kind === "needs_approval")
      await session.approve(phase.collectionId);
    else await session.addCollection();
  }
  async function importTasks() {
    if (demo || !accepted || blocked || !target)
      throw new Error("Review the import before continuing.");
    const current = session.getSnapshot().phase;
    if (current.kind !== "ready" || !current.connection.isCurrent())
      throw new Error("Wait for the destination to be verified.");
    const active = taskRepository(current.connection);
    const fresh = (await active.discoverTypes()).find(
      (t) => t.name === target.name,
    );
    if (!fresh || JSON.stringify(fresh) !== JSON.stringify(target)) {
      invalidate();
      throw new Error(
        "Destination definitions changed. Select the type and preview again.",
      );
    }
    cancel.current = new AbortController();
    if (!active.isCurrent())
      throw new Error("The destination changed. Preview again.");
    await active.importTasks(plan, setReport, cancel.current.signal);
    setAccepted(false);
  }
  const displayedTasks =
    source?.tasks.filter((t) => !filter || t.project_id === filter) ?? [];
  const pending = [
    ...new Set([
      ...(snapshot.sync?.writes?.pending ?? []).map((w) => w.mutationId),
      ...(snapshot.sync?.writes?.rejected ?? []).map((w) => w.mutationId),
      ...report
        .filter((r) => r.status === "uncertain" && r.mutationId)
        .map((r) => r.mutationId!),
    ]),
  ];
  const hasUncertain = report.some((r) => r.status === "uncertain");
  const currentStep = plan.length ? 2 : source ? 1 : 0;

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <a href="/" className="brand">
            <img src="/mark.svg" alt="" width="28" height="28" />
            TaskNotes <span>/ import</span>
          </a>
          <div className="header-actions">
            <ThemeSelector />
            <a
              href="https://app.tasknotes.dev"
              target="_blank"
              rel="noreferrer"
              aria-label="Open TaskNotes"
            >
              <span className="external-label">Open TaskNotes </span>
              <span aria-hidden="true">↗</span>
            </a>
          </div>
        </div>
      </header>
      <main className={`import-page${source ? " has-source" : ""}`}>
        <header className="page-heading">
          <h1>Import from Todoist</h1>
          <ol className="progress" aria-label="Import progress">
            {["Tasks", "Collection", "Review"].map((label, index) => (
              <li
                key={label}
                aria-current={currentStep === index ? "step" : undefined}
                className={index < currentStep ? "complete" : ""}
              >
                <span className="progress-number" aria-hidden="true">
                  {index < currentStep ? "✓" : index + 1}
                </span>
                {label}
              </li>
            ))}
          </ol>
        </header>
        {error && (
          <div className="notice error" role="alert">
            <p>{error}</p>
            <button className="quiet" onClick={() => setError("")}>
              Dismiss
            </button>
          </div>
        )}
        {busy && (
          <div className="notice" role="status">
            {busy}…{" "}
            {busy === "Importing" && (
              <button onClick={() => cancel.current?.abort()}>
                Stop after the current task
              </button>
            )}
          </div>
        )}
        {demo && (
          <div className="notice demo">
            <span>Example · No changes will be saved.</span>
            <button
              className="quiet"
              disabled={frozen}
              onClick={() => {
                setDemo(false);
                setSource(undefined);
                setTarget(undefined);
                invalidate();
              }}
            >
              Leave example
            </button>
          </div>
        )}
        <div className="workspace">
          <div className="steps">
            <section className="card">
              <div className="section-heading">
                {!source && (
                  <svg
                    className="source-mark"
                    viewBox="0 0 32 32"
                    fill="none"
                    aria-hidden="true"
                  >
                    <rect width="32" height="32" rx="6" fill="#e44332" />
                    <path
                      d="m7 10 3 2 10-5m-13 9 3 2 10-5m-13 9 3 2 10-5m3-11h2m-2 6h2m-2 6h2"
                      stroke="white"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
                <h2>{source ? "Tasks" : "Connect your Todoist account"}</h2>
                {source && (
                  <span className="pill">
                    {demo ? "Example" : "Todoist connected"}
                  </span>
                )}
              </div>
              {!source ? (
                <>
                  <p className="muted connection-hint">
                    Choose what to bring over. Your Todoist tasks stay
                    unchanged.
                  </p>
                  <div className="connect-actions">
                    <button
                      className="primary"
                      disabled={frozen}
                      onClick={() =>
                        void action("Opening Todoist", authorizeTodoist)
                      }
                    >
                      Connect Todoist <span>↗</span>
                    </button>
                    <button
                      className="quiet"
                      disabled={frozen}
                      onClick={() => {
                        setDemo(true);
                        setSource(exampleSource);
                        setSelected(
                          new Set(exampleSource.tasks.map((t) => t.id)),
                        );
                        setTypes([exampleTarget]);
                        chooseTarget(exampleTarget);
                      }}
                    >
                      Try an example
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="row">
                    <label className="grow">
                      Project
                      <select
                        value={filter}
                        disabled={frozen}
                        onChange={(e) => setFilter(e.target.value)}
                      >
                        <option value="">All projects</option>
                        {source.projects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <span className="selection-count">
                      {selected.size} selected
                    </span>
                  </div>
                  <div className="row compact">
                    <button
                      className="quiet"
                      disabled={frozen}
                      onClick={() => {
                        invalidate();
                        setSelected(
                          new Set([
                            ...selected,
                            ...displayedTasks.map((t) => t.id),
                          ]),
                        );
                      }}
                    >
                      Select shown
                    </button>
                    <button
                      className="quiet"
                      disabled={frozen}
                      onClick={() => {
                        invalidate();
                        setSelected(
                          new Set(
                            [...selected].filter(
                              (id) => !displayedTasks.some((t) => t.id === id),
                            ),
                          ),
                        );
                      }}
                    >
                      Deselect shown
                    </button>
                  </div>
                  <div className="task-list">
                    {displayedTasks.map((t) => (
                      <label key={t.id} className="task-choice">
                        <input
                          type="checkbox"
                          disabled={frozen}
                          checked={selected.has(t.id)}
                          onChange={(e) => {
                            invalidate();
                            const next = new Set(selected);
                            e.target.checked
                              ? next.add(t.id)
                              : next.delete(t.id);
                            setSelected(next);
                          }}
                        />
                        <span>
                          {t.content}
                          <small>
                            {
                              source.projects.find((p) => p.id === t.project_id)
                                ?.name
                            }
                            {t.due?.is_recurring ? " · Repeats" : ""}
                          </small>
                        </span>
                      </label>
                    ))}
                    {!displayedTasks.length && (
                      <p>No active tasks in this selection.</p>
                    )}
                  </div>
                  {!demo && (
                    <button
                      className="quiet"
                      disabled={frozen}
                      onClick={() => {
                        setSource(undefined);
                        setSelected(new Set());
                        invalidate();
                      }}
                    >
                      Clear loaded Todoist data
                    </button>
                  )}
                </>
              )}
            </section>
            {source && (
              <section className="card">
                <div className="section-heading">
                  <h2>Collection</h2>
                </div>
                {!demo && (
                  <>
                    <button
                      disabled={frozen}
                      onClick={() =>
                        void action("Connecting to mdbase", beginDestination)
                      }
                    >
                      {phase.kind === "starting" || phase.kind === "signed_out"
                        ? "Connect mdbase"
                        : phase.kind === "needs_approval"
                          ? "Approve collection"
                          : "Choose collection"}{" "}
                      ↗
                    </button>
                    {!["starting", "signed_out", "choosing", "ready"].includes(
                      phase.kind,
                    ) && (
                      <p className="muted" role="status">
                        Connection: {phase.kind.replaceAll("_", " ")}
                      </p>
                    )}
                    {"problem" in phase && phase.problem && (
                      <p className="error-text">{phase.problem.message}</p>
                    )}
                    {snapshot.collections.length > 0 && (
                      <label>
                        Previously authorized collection
                        <select
                          disabled={frozen}
                          value={
                            "collectionId" in phase
                              ? (phase.collectionId ?? "")
                              : ""
                          }
                          onChange={(e) => {
                            invalidate();
                            setSetupPlan(undefined);
                            if (e.target.value)
                              void action("Selecting collection", async () => {
                                await session.select(e.target.value);
                              });
                          }}
                        >
                          <option value="">Choose…</option>
                          {snapshot.collections.map((c) => (
                            <option key={c.collectionId} value={c.collectionId}>
                              {c.displayName}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {phase.kind === "needs_setup" && (
                      <div className="setup">
                        <h3>Review TaskNotes setup</h3>
                        <button
                          disabled={frozen}
                          onClick={() =>
                            void action("Reviewing setup", async () => {
                              setSetupPlan(await session.setup.plan());
                            })
                          }
                        >
                          Review proposed setup
                        </button>
                        {setupPlan && (
                          <>
                            <p>{setupPlan.summary}</p>
                            <p>
                              Install the current TaskNotes task and settings
                              definitions. Existing tasks stay unchanged.
                            </p>
                            {setupPlan.changes.map((change) => (
                              <p key={`${change.kind}:${change.target}`}>
                                {change.message}
                              </p>
                            ))}
                            {setupPlan.conflicts.map((conflict) => (
                              <p className="error-text" key={conflict.target}>
                                {conflict.message}
                              </p>
                            ))}
                            <details>
                              <summary>Exact proposed changes</summary>
                              <pre>{JSON.stringify(setupPlan, null, 2)}</pre>
                            </details>
                            <button
                              className="primary"
                              disabled={frozen || !setupPlan.canApply}
                              onClick={() =>
                                void action(
                                  "Applying reviewed setup",
                                  async () => {
                                    const result =
                                      await session.setup.apply(setupPlan);
                                    setSetupPlan(undefined);
                                    if (result.outcome !== "applied")
                                      throw new Error(
                                        result.outcome === "changed"
                                          ? "Collection setup changed. Review a fresh plan before approving."
                                          : "Setup outcome is unknown. Check the connection before reviewing again.",
                                      );
                                  },
                                )
                              }
                            >
                              Approve setup
                            </button>
                          </>
                        )}
                        <button
                          className="quiet"
                          disabled={frozen}
                          onClick={() =>
                            void action("Closing collection", async () => {
                              setSetupPlan(undefined);
                              await session.chooseAnother();
                            })
                          }
                        >
                          Not now
                        </button>
                      </div>
                    )}
                  </>
                )}
                {(demo || types.length > 0) && (
                  <>
                    <p className="connected">
                      ✓ {demo ? "Example collection" : collectionName}
                    </p>
                    <label>
                      Task type
                      <select
                        disabled={frozen}
                        value={target?.name ?? ""}
                        onChange={(e) => {
                          const t = types.find(
                            (t) => t.name === e.target.value,
                          );
                          if (t) chooseTarget(t);
                        }}
                      >
                        <option value="">Choose a type…</option>
                        {types.map((t) => (
                          <option key={t.name}>{t.name}</option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
                {target && (
                  <div className="mapping">
                    <label>
                      Import folder
                      <input
                        disabled={frozen}
                        value={options.folder}
                        onChange={(e) => {
                          invalidate();
                          setOptions({ ...options, folder: e.target.value });
                        }}
                      />
                    </label>
                    <label>
                      Todoist task dates
                      <select
                        disabled={frozen}
                        value={options.dateTarget}
                        onChange={(e) => {
                          invalidate();
                          setOptions({
                            ...options,
                            dateTarget: e.target
                              .value as ImportOptions["dateTarget"],
                          });
                        }}
                      >
                        <option value="scheduled">Scheduled date</option>
                        <option value="due">Due date</option>
                      </select>
                    </label>
                    <p className="muted">Deadlines become due dates.</p>
                    <h3>Priorities</h3>
                    <div className="priority-grid">
                      {[1, 2, 3, 4].map((priority) => (
                        <label key={priority}>
                          API priority {priority}
                          <select
                            disabled={frozen}
                            value={options.priorities[priority] ?? ""}
                            onChange={(e) => {
                              invalidate();
                              setOptions({
                                ...options,
                                priorities: {
                                  ...options.priorities,
                                  [priority]: e.target.value,
                                },
                              });
                            }}
                          >
                            <option value="">Choose…</option>
                            {model?.priorities.map((p) => (
                              <option key={p.value} value={p.value}>
                                {p.label || p.value}
                              </option>
                            ))}
                          </select>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            )}
            {source && target && (
              <section className="card">
                <div className="section-heading">
                  <h2>Review</h2>
                </div>
                <button
                  disabled={frozen || !source || !target || !selected.size}
                  onClick={() =>
                    void action("Preparing preview", async () => {
                      if (source && target) {
                        setAccepted(false);
                        setReport([]);
                        setPlan(
                          await makePlan(source, selected, target, options),
                        );
                      }
                    })
                  }
                >
                  Preview {selected.size || ""} tasks →
                </button>
                {plan.length > 0 && (
                  <>
                    <div className="stats">
                      <div>
                        <strong>{plan.length - blocked}</strong>
                        <span>ready</span>
                      </div>
                      <div>
                        <strong>{blocked}</strong>
                        <span>need review</span>
                      </div>
                    </div>
                    {blocked > 0 && (
                      <p className="error-text">
                        Deselect blocked tasks or adjust their mappings, then
                        preview again.
                      </p>
                    )}
                    <div className="review-list">
                      {plan.map((p) => (
                        <button
                          className={`review-item ${preview?.sourceId === p.sourceId ? "active" : ""}`}
                          aria-pressed={preview?.sourceId === p.sourceId}
                          key={p.sourceId}
                          onClick={() => setPreviewId(p.sourceId)}
                        >
                          <span>{p.title}</span>
                          <small>
                            {p.errors.length
                              ? "Needs review"
                              : p.warnings.length
                                ? "Ready · notes"
                                : "Ready"}
                          </small>
                        </button>
                      ))}
                    </div>
                    <label className="check-line">
                      <input
                        type="checkbox"
                        disabled={frozen || blocked > 0}
                        checked={accepted}
                        onChange={(e) => setAccepted(e.target.checked)}
                      />
                      <span>
                        I’ve reviewed these tasks. Skip previous imports; leave
                        existing records unchanged.
                      </span>
                    </label>
                    <button
                      className="primary"
                      disabled={
                        frozen ||
                        demo ||
                        !accepted ||
                        blocked > 0 ||
                        pending.length > 0 ||
                        hasUncertain ||
                        phase.kind !== "ready"
                      }
                      onClick={() => void action("Importing", importTasks)}
                    >
                      Import {plan.length} tasks
                    </button>
                    {demo && (
                      <p className="muted">
                        Importing is disabled in example mode.
                      </p>
                    )}
                  </>
                )}
                {pending.length > 0 && (
                  <div className="notice">
                    <strong>{pending.length} write(s) need recovery</strong>
                    <p>Check the previous writes before retrying.</p>
                    <button
                      disabled={frozen}
                      onClick={() =>
                        void action("Recovering writes", async () => {
                          const current = session.getSnapshot().phase;
                          if (current.kind !== "ready")
                            throw new Error(
                              "Open the original collection to check its writes.",
                            );
                          await taskRepository(
                            current.connection,
                          ).recoverWrites(pending, plan, report, setReport);
                          setAccepted(false);
                        })
                      }
                    >
                      Recover pending writes
                    </button>
                  </div>
                )}
                {report.length > 0 && (
                  <div className="report" aria-live="polite">
                    <h3>Import report</h3>
                    <p>
                      {report.filter((r) => r.status === "created").length}{" "}
                      created ·{" "}
                      {report.filter((r) => r.status === "skipped").length}{" "}
                      skipped ·{" "}
                      {
                        report.filter((r) =>
                          ["failed", "uncertain"].includes(r.status),
                        ).length
                      }{" "}
                      need attention ·{" "}
                      {report.filter((r) => r.status === "not-started").length}{" "}
                      not started
                    </p>
                    {report
                      .filter((r) => r.message)
                      .map((r) => (
                        <p key={r.sourceId}>
                          <strong>{r.status}: </strong>
                          {r.message}
                        </p>
                      ))}
                    <button
                      onClick={() =>
                        download(
                          "tasknotes-import-report.json",
                          JSON.stringify(
                            {
                              generatedAt: new Date().toISOString(),
                              records: report,
                            },
                            null,
                            2,
                          ),
                        )
                      }
                    >
                      Download report
                    </button>
                  </div>
                )}
              </section>
            )}
          </div>
          {preview && (
            <aside>
              <div className="preview-panel">
                <div className="preview-heading">
                  <span className="preview-label">Task preview</span>
                  <span
                    className={`preview-status${preview.errors.length ? " needs-review" : ""}`}
                  >
                    {preview.errors.length ? "Needs review" : "Ready"}
                  </span>
                </div>
                <h2>{preview.title}</h2>
                {
                  <>
                    <details className="file-details">
                      <summary>File location</summary>
                      <p className="file-path">{preview.path}</p>
                    </details>
                    {preview.errors.map((e, i) => (
                      <p className="preview-error" key={`e${i}`}>
                        {e}
                      </p>
                    ))}
                    {preview.warnings.length > 0 && (
                      <details className="import-notes" key={preview.sourceId}>
                        <summary>
                          Import notes <span>{preview.warnings.length}</span>
                        </summary>
                        {preview.warnings.map((w, i) => (
                          <p className="preview-warning" key={`w${i}`}>
                            {w}
                          </p>
                        ))}
                      </details>
                    )}
                    <pre aria-label="Markdown preview">{markdown(preview)}</pre>
                    <button
                      onClick={() =>
                        download(
                          preview.path.split("/").at(-1)!,
                          markdown(preview),
                          "text/markdown",
                        )
                      }
                    >
                      Download Markdown
                    </button>
                  </>
                }
              </div>
            </aside>
          )}
        </div>
        <details className="privacy" id="privacy">
          <summary>Privacy &amp; import limits</summary>
          <p>
            Active tasks only. Comments, attachments, reminders, assignees,
            completed history, and subtask hierarchy aren’t imported.
            Unsupported recurrence and floating times are flagged before import.
          </p>
          <p>
            Todoist access is read-only. Source tasks and tokens stay in browser
            memory until reload; OAuth verification briefly uses session
            storage. No analytics or importer database. Cloudflare serves the
            site; your mdbase provider stores imported tasks.
          </p>
          <p>
            Connect saves its own authorizations. The importer can read
            collection records, create tasks, and apply approved setup—not edit
            or delete existing tasks. Revoke access in Todoist or Connect when
            finished.
          </p>
        </details>
      </main>
    </>
  );
}

export async function loadTodoist(token: string): Promise<SourceData> {
  return new TodoistApi(token).load();
}
