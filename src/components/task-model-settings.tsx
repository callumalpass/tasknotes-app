import { Save, Settings2 } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { useRepository } from "../app/repository-context";
import { TaskNotesSelectField } from "./tasknotes-controls";

import type { TaskCollectionConfiguration } from "../domain/task-configuration";

type SaveState = "idle" | "saving" | "saved" | "error";

interface TaskModelSettingsDraft {
  defaultStatus: string;
  defaultPriority: string;
  maintainDueDateOffset: boolean;
  resetCheckboxesOnRecurrence: boolean;
  defaultMaterialization: "manual" | "on_completion" | "rolling";
  defaultNextTrigger: "completion" | "completion_or_skip";
  pastHorizon: string;
  futureHorizon: string;
  autoStopOnComplete: boolean;
  writeFormat: "wikilink" | "markdown";
  moveOnArchive: boolean;
  archiveFolder: string;
  templatingEnabled: boolean;
  templatePath: string;
  statusAutomation: Record<
    string,
    { autoArchive: boolean; autoArchiveDelay: number }
  >;
}

export function TaskModelSettingsEditor() {
  const { configuration, repository, updateTaskModelSettings } =
    useRepository();
  const [access, setAccess] = useState<{
    writable: boolean;
    source: string;
    reason?: string;
  } | null>(null);
  const [draft, setDraft] = useState(() => settingsDraft(configuration));
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void repository
      .taskModelSettingsAccess()
      .then((result) => {
        if (active) setAccess(result);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setAccess({
          writable: false,
          source: "Task type contract",
          reason: reason instanceof Error ? reason.message : String(reason),
        });
      });
    return () => {
      active = false;
    };
  }, [repository]);

  const original = useMemo(() => settingsDraft(configuration), [configuration]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(original);
  const writable = access?.writable === true;

  function change(patch: Partial<TaskModelSettingsDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setSaveState("idle");
    setError("");
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!writable || !dirty || saveState === "saving") return;
    setSaveState("saving");
    setError("");
    try {
      await updateTaskModelSettings({
        defaultStatus: draft.defaultStatus,
        defaultPriority: draft.defaultPriority,
        recurrence: {
          maintainDueDateOffset: draft.maintainDueDateOffset,
          resetCheckboxesOnRecurrence: draft.resetCheckboxesOnRecurrence,
        },
        occurrences: {
          defaultMaterialization: draft.defaultMaterialization,
          defaultNextTrigger: draft.defaultNextTrigger,
          pastHorizon: draft.pastHorizon,
          futureHorizon: draft.futureHorizon,
        },
        timeTracking: {
          autoStopOnComplete: draft.autoStopOnComplete,
        },
        links: { writeFormat: draft.writeFormat },
        archive: {
          moveOnArchive: draft.moveOnArchive,
          folder: draft.archiveFolder,
        },
        templating: {
          enabled: draft.templatingEnabled,
          templatePath: draft.templatePath,
        },
        statusAutomation: changedStatusAutomation(
          draft.statusAutomation,
          original.statusAutomation,
        ),
      });
      setSaveState("saved");
    } catch (reason) {
      setSaveState("error");
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  return (
    <form
      className="task-model-settings"
      onSubmit={(event) => void save(event)}
    >
      <div className="setting-row task-model-setting-row">
        <Settings2 aria-hidden="true" size={20} strokeWidth={1.6} />
        <span>Task behavior</span>
        <small>{access?.source ?? "Checking type contract"}</small>
      </div>
      <p className="section-copy">
        These settings travel with the collection in its TaskNotes type
        contract.
      </p>
      {access && !access.writable ? (
        <p className="settings-read-only" role="status">
          {access.reason}
        </p>
      ) : null}
      <fieldset disabled={!writable || saveState === "saving"}>
        <legend className="visually-hidden">Task model settings</legend>
        <div className="task-model-settings-grid">
          <TaskNotesSelectField
            label="Default status"
            options={configuration.statuses}
            value={draft.defaultStatus}
            onChange={(defaultStatus) => change({ defaultStatus })}
          />
          <TaskNotesSelectField
            label="Default priority"
            options={configuration.priorities}
            value={draft.defaultPriority}
            onChange={(defaultPriority) => change({ defaultPriority })}
          />
          <TaskNotesSelectField
            label="New recurring tasks"
            options={[
              { value: "manual", label: "Virtual occurrences" },
              { value: "on_completion", label: "Create after completion" },
              { value: "rolling", label: "Rolling window" },
            ]}
            value={draft.defaultMaterialization}
            onChange={(value) =>
              change({
                defaultMaterialization:
                  value as TaskModelSettingsDraft["defaultMaterialization"],
              })
            }
          />
          <TaskNotesSelectField
            label="Create next occurrence"
            options={[
              { value: "completion", label: "After completion" },
              {
                value: "completion_or_skip",
                label: "After completion or skip",
              },
            ]}
            value={draft.defaultNextTrigger}
            onChange={(value) =>
              change({
                defaultNextTrigger:
                  value as TaskModelSettingsDraft["defaultNextTrigger"],
              })
            }
          />
          <label className="form-field">
            <span>Past occurrence horizon</span>
            <input
              aria-label="Past occurrence horizon"
              placeholder="P0D"
              value={draft.pastHorizon}
              onChange={(event) => change({ pastHorizon: event.target.value })}
            />
            <small>ISO 8601 duration</small>
          </label>
          <label className="form-field">
            <span>Future occurrence horizon</span>
            <input
              aria-label="Future occurrence horizon"
              placeholder="P14D"
              value={draft.futureHorizon}
              onChange={(event) =>
                change({ futureHorizon: event.target.value })
              }
            />
            <small>ISO 8601 duration</small>
          </label>
          <TaskNotesSelectField
            label="Record links"
            options={[
              { value: "wikilink", label: "Wikilinks" },
              { value: "markdown", label: "Markdown links" },
            ]}
            value={draft.writeFormat}
            onChange={(value) =>
              change({
                writeFormat: value as TaskModelSettingsDraft["writeFormat"],
              })
            }
          />
          <label className="form-field">
            <span>Archive folder</span>
            <input
              aria-label="Archive folder"
              value={draft.archiveFolder}
              onChange={(event) =>
                change({ archiveFolder: event.target.value })
              }
            />
          </label>
          <label className="form-field">
            <span>Task template</span>
            <input
              aria-label="Task template"
              placeholder="Templates/Task.md"
              value={draft.templatePath}
              onChange={(event) => change({ templatePath: event.target.value })}
            />
          </label>
        </div>
        <div className="task-model-toggles">
          <SettingToggle
            checked={draft.maintainDueDateOffset}
            label="Keep due-date offset when a task repeats"
            onChange={(maintainDueDateOffset) =>
              change({ maintainDueDateOffset })
            }
          />
          <SettingToggle
            checked={draft.resetCheckboxesOnRecurrence}
            label="Reset note checkboxes when a task repeats"
            onChange={(resetCheckboxesOnRecurrence) =>
              change({ resetCheckboxesOnRecurrence })
            }
          />
          <SettingToggle
            checked={draft.autoStopOnComplete}
            label="Stop a running timer when its task completes"
            onChange={(autoStopOnComplete) => change({ autoStopOnComplete })}
          />
          <SettingToggle
            checked={draft.moveOnArchive}
            label="Move archived task files into the archive folder"
            onChange={(moveOnArchive) => change({ moveOnArchive })}
          />
          <SettingToggle
            checked={draft.templatingEnabled}
            label="Use the task template for new tasks"
            onChange={(templatingEnabled) => change({ templatingEnabled })}
          />
        </div>
        <section
          aria-labelledby="auto-archive-settings-title"
          className="status-automation-settings"
        >
          <div>
            <h3 id="auto-archive-settings-title">Auto archive</h3>
            <p className="section-copy">
              Archive tasks after they enter a selected status. Recurring series
              are always excluded.
            </p>
          </div>
          <div className="status-automation-list">
            {configuration.statuses.map((status) => {
              const automation = draft.statusAutomation[status.value] ?? {
                autoArchive: false,
                autoArchiveDelay: 5,
              };
              return (
                <div className="status-automation-row" key={status.value}>
                  <label className="task-model-toggle">
                    <input
                      checked={automation.autoArchive}
                      type="checkbox"
                      onChange={(event) =>
                        change({
                          statusAutomation: {
                            ...draft.statusAutomation,
                            [status.value]: {
                              ...automation,
                              autoArchive: event.target.checked,
                            },
                          },
                        })
                      }
                    />
                    <span>{status.label}</span>
                  </label>
                  <label className="auto-archive-delay">
                    <span>Delay</span>
                    <input
                      aria-label={`${status.label} auto-archive delay in minutes`}
                      disabled={!automation.autoArchive}
                      min="0"
                      step="1"
                      type="number"
                      value={automation.autoArchiveDelay}
                      onChange={(event) =>
                        change({
                          statusAutomation: {
                            ...draft.statusAutomation,
                            [status.value]: {
                              ...automation,
                              autoArchiveDelay: Math.max(
                                0,
                                Number.parseInt(event.target.value, 10) || 0,
                              ),
                            },
                          },
                        })
                      }
                    />
                    <span>min</span>
                  </label>
                </div>
              );
            })}
          </div>
        </section>
      </fieldset>
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
      {writable ? (
        <div className="task-model-save">
          <button
            className="text-action"
            disabled={!dirty || saveState === "saving"}
            type="submit"
          >
            <Save aria-hidden="true" size={16} />
            {saveState === "saving" ? "Saving" : "Save task settings"}
          </button>
          {saveState === "saved" ? (
            <span role="status">Saved to the type contract.</span>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}

function changedStatusAutomation(
  draft: TaskModelSettingsDraft["statusAutomation"],
  original: TaskModelSettingsDraft["statusAutomation"],
) {
  return Object.fromEntries(
    Object.entries(draft).filter(([status, automation]) => {
      const previous = original[status];
      return (
        !previous ||
        previous.autoArchive !== automation.autoArchive ||
        previous.autoArchiveDelay !== automation.autoArchiveDelay
      );
    }),
  );
}

function SettingToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange(value: boolean): void;
}) {
  return (
    <label className="task-model-toggle">
      <input
        checked={checked}
        type="checkbox"
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function settingsDraft(
  configuration: TaskCollectionConfiguration,
): TaskModelSettingsDraft {
  return {
    defaultStatus: configuration.defaults.status,
    defaultPriority: configuration.defaults.priority,
    maintainDueDateOffset: configuration.recurrence.maintainDueDateOffset,
    resetCheckboxesOnRecurrence:
      configuration.recurrence.resetCheckboxesOnRecurrence,
    defaultMaterialization: configuration.occurrences.defaultMaterialization,
    defaultNextTrigger: configuration.occurrences.defaultNextTrigger,
    pastHorizon: configuration.occurrences.pastHorizon ?? "P0D",
    futureHorizon: configuration.occurrences.futureHorizon ?? "P14D",
    autoStopOnComplete: configuration.timeTracking.autoStopOnComplete,
    writeFormat: configuration.linkWriteFormat,
    moveOnArchive: configuration.archive.moveOnArchive,
    archiveFolder: configuration.archive.folder,
    templatingEnabled: configuration.templating.enabled,
    templatePath: configuration.templating.templatePath ?? "",
    statusAutomation: Object.fromEntries(
      configuration.statuses.map((status) => [
        status.value,
        {
          autoArchive: status.autoArchive,
          autoArchiveDelay: status.autoArchiveDelay,
        },
      ]),
    ),
  };
}
