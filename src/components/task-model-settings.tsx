import { useLingui } from "@lingui/react/macro";
import { Trans } from "@lingui/react/macro";
import { t as translate } from "@lingui/core/macro";
import {
  useEffect,
  useId,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { useRepository } from "../app/repository-context";
import { DurationField } from "./duration-field";
import { OperationErrorNotice } from "./operation-error-notice";
import { TaskNotesSelectField } from "./tasknotes-controls";
import {
  useTaskModelDraft,
  type TaskModelSettingsDraft,
} from "./task-model-draft";

type SaveState = "idle" | "saving" | "saved" | "error";

const materializationOptions = [
  {
    value: "manual",
    get label() {
      return translate({ message: "Only when I create one" });
    },
    get description() {
      return translate({
        message:
          "Each date is tracked on the repeating task. A separate task file is created only when you ask for one.",
      });
    },
  },
  {
    value: "on_completion",
    get label() {
      return translate({ message: "When the previous one is completed" });
    },
    get description() {
      return translate({
        message:
          "Completing an occurrence's task file creates the file for the next date.",
      });
    },
  },
  {
    value: "rolling",
    get label() {
      return translate({ message: "For an upcoming window" });
    },
    get description() {
      return translate({
        message:
          "Task files are kept for a fixed span of dates, such as the next 14 days.",
      });
    },
  },
] as const;

const linkFormatOptions = [
  {
    value: "wikilink",
    get label() {
      return translate({ message: "Wikilinks" });
    },
    description: "[[Weekly review]]",
  },
  {
    value: "markdown",
    get label() {
      return translate({ message: "Markdown links" });
    },
    description: "[Weekly review](Weekly review.md)",
  },
] as const;

export function TaskModelSettingsEditor() {
  const { t } = useLingui();
  const { configuration, repository, updateTaskModelSettings } =
    useRepository();
  const [access, setAccess] = useState<{
    writable: boolean;
    source: string;
    reason?: string;
  } | null>(null);
  const { draft, original, dirty, change, discard } = useTaskModelDraft(
    repository,
    configuration,
  );
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState("");
  const ids = useId();

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
          source: "Collection settings",
          reason: reason instanceof Error ? reason.message : String(reason),
        });
      });
    return () => {
      active = false;
    };
  }, [repository]);

  // Reloading or closing the page is the one exit that would lose a draft.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const writable = access?.writable === true;

  function update(patch: Partial<TaskModelSettingsDraft>) {
    change(patch);
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
      discard();
      setSaveState("saved");
    } catch (reason) {
      setSaveState("error");
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  const materialization = materializationOptions.find(
    (option) => option.value === draft.defaultMaterialization,
  );
  const linkFormat = linkFormatOptions.find(
    (option) => option.value === draft.writeFormat,
  );

  return (
    <form
      className="task-model-settings"
      onSubmit={(event) => void save(event)}
    >
      <p className="section-copy">
        <Trans>
          Saved with the collection and used by every app that opens it.
        </Trans>
      </p>
      {access?.source && !/contract/i.test(access.source) ? (
        <p className="settings-source">{access.source}</p>
      ) : null}
      {!access ? (
        <p className="settings-read-only" role="status">
          <Trans>Checking collection settings…</Trans>
        </p>
      ) : !access.writable ? (
        <p className="settings-read-only" role="status">
          {access.reason}
        </p>
      ) : null}
      <fieldset disabled={!writable || saveState === "saving"}>
        <legend className="visually-hidden">
          <Trans>Collection behavior</Trans>
        </legend>

        <SettingsGroup title={translate({ message: "New tasks" })}>
          <div className="task-model-settings-grid">
            <TaskNotesSelectField
              label={translate({ message: "Default status" })}
              options={configuration.statuses}
              value={draft.defaultStatus}
              onChange={(defaultStatus) => update({ defaultStatus })}
            />
            <TaskNotesSelectField
              label={translate({ message: "Default priority" })}
              options={configuration.priorities}
              value={draft.defaultPriority}
              onChange={(defaultPriority) => update({ defaultPriority })}
            />
          </div>
          <SettingCheckbox
            checked={draft.templatingEnabled}
            label={translate({ message: "Start new tasks from a template" })}
            onChange={(templatingEnabled) => update({ templatingEnabled })}
          />
          {draft.templatingEnabled ? (
            <label className="form-field settings-dependent-field">
              <span>
                <Trans>Template file</Trans>
              </span>
              <input
                placeholder={translate({ message: "Templates/Task.md" })}
                value={draft.templatePath}
                onChange={(event) =>
                  update({ templatePath: event.target.value })
                }
              />
            </label>
          ) : null}
        </SettingsGroup>

        <SettingsGroup title={translate({ message: "Repeating tasks" })}>
          <div className="settings-field-with-hint">
            <TaskNotesSelectField
              ariaDescribedBy={`${ids}-materialization`}
              label={translate({ message: "Create a task file for each date" })}
              options={materializationOptions}
              value={draft.defaultMaterialization}
              onChange={(value) =>
                update({
                  defaultMaterialization:
                    value as TaskModelSettingsDraft["defaultMaterialization"],
                })
              }
            />
            <p className="setting-hint" id={`${ids}-materialization`}>
              {materialization?.description}
            </p>
          </div>
          {draft.defaultMaterialization === "on_completion" ? (
            <SettingCheckbox
              checked={draft.defaultNextTrigger === "completion_or_skip"}
              label={translate({
                message:
                  "Also create the next file when an occurrence is skipped",
              })}
              onChange={(skip) =>
                update({
                  defaultNextTrigger: skip
                    ? "completion_or_skip"
                    : "completion",
                })
              }
            />
          ) : null}
          {draft.defaultMaterialization === "rolling" ? (
            <div className="task-model-settings-grid settings-dependent-field">
              <DurationField
                label={translate({ message: "Keep files for past dates" })}
                value={draft.pastHorizon}
                onChange={(pastHorizon) => update({ pastHorizon })}
              />
              <DurationField
                label={translate({ message: "Create files ahead" })}
                value={draft.futureHorizon}
                onChange={(futureHorizon) => update({ futureHorizon })}
              />
            </div>
          ) : null}
          <SettingCheckbox
            checked={draft.maintainDueDateOffset}
            description={translate({
              message:
                "A task scheduled Monday and due Wednesday stays two days apart on each repeat.",
            })}
            label={translate({
              message: "Keep the gap between scheduled and due dates",
            })}
            onChange={(maintainDueDateOffset) =>
              update({ maintainDueDateOffset })
            }
          />
          <SettingCheckbox
            checked={draft.resetCheckboxesOnRecurrence}
            label={translate({
              message: "Clear checklist items in the note on each repeat",
            })}
            onChange={(resetCheckboxesOnRecurrence) =>
              update({ resetCheckboxesOnRecurrence })
            }
          />
        </SettingsGroup>

        <SettingsGroup title={translate({ message: "Archive" })}>
          <SettingCheckbox
            checked={draft.moveOnArchive}
            label={translate({
              message: "Move archived task files into a folder",
            })}
            onChange={(moveOnArchive) => update({ moveOnArchive })}
          />
          {draft.moveOnArchive ? (
            <label className="form-field settings-dependent-field">
              <span>
                <Trans>Archive folder</Trans>
              </span>
              <input
                value={draft.archiveFolder}
                onChange={(event) =>
                  update({ archiveFolder: event.target.value })
                }
              />
            </label>
          ) : null}
          <section
            aria-labelledby={`${ids}-auto-archive`}
            className="status-automation-settings"
          >
            <h4 id={`${ids}-auto-archive`}>
              <Trans>Archive automatically</Trans>
            </h4>
            <p className="setting-hint">
              <Trans>
                Archive a task once it has been in a chosen status for a while.
                Repeating tasks are never archived automatically.
              </Trans>
            </p>
            <div className="status-automation-list">
              {configuration.statuses.map((status) => {
                const automation = draft.statusAutomation[status.value] ?? {
                  autoArchive: false,
                  autoArchiveDelay: 5,
                };
                const inputId = `${ids}-archive-${status.value}`;
                function automate(patch: Partial<typeof automation>): void {
                  update({
                    statusAutomation: {
                      ...draft.statusAutomation,
                      [status.value]: { ...automation, ...patch },
                    },
                  });
                }
                return (
                  <div className="status-automation-row" key={status.value}>
                    <div className="task-model-toggle">
                      <input
                        checked={automation.autoArchive}
                        id={inputId}
                        type="checkbox"
                        onChange={(event) =>
                          automate({ autoArchive: event.target.checked })
                        }
                      />
                      <label htmlFor={inputId}>{status.label}</label>
                    </div>
                    {automation.autoArchive ? (
                      <label className="auto-archive-delay">
                        <span>
                          <Trans>after</Trans>
                        </span>
                        <input
                          aria-label={translate`${status.label} auto-archive delay in minutes`}
                          min="0"
                          step="1"
                          type="number"
                          value={automation.autoArchiveDelay}
                          onChange={(event) =>
                            automate({
                              autoArchiveDelay: Math.max(
                                0,
                                Number.parseInt(event.target.value, 10) || 0,
                              ),
                            })
                          }
                        />
                        <span>
                          <Trans>min</Trans>
                        </span>
                      </label>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        </SettingsGroup>

        <SettingsGroup
          title={translate({ message: "Links and time tracking" })}
        >
          <div className="settings-field-with-hint">
            <TaskNotesSelectField
              ariaDescribedBy={`${ids}-links`}
              label={translate({ message: "Link format" })}
              options={linkFormatOptions}
              value={draft.writeFormat}
              onChange={(value) =>
                update({
                  writeFormat: value as TaskModelSettingsDraft["writeFormat"],
                })
              }
            />
            <p className="setting-hint" id={`${ids}-links`}>
              <Trans>
                Used when TaskNotes writes links to projects, people, and other
                tasks, for example{" "}
              </Trans>
              <code>{linkFormat?.description}</code>.
            </p>
          </div>
          <SettingCheckbox
            checked={draft.autoStopOnComplete}
            label={translate({
              message: "Stop a running timer when its task is completed",
            })}
            onChange={(autoStopOnComplete) => update({ autoStopOnComplete })}
          />
        </SettingsGroup>
      </fieldset>
      {error ? (
        <OperationErrorNotice
          action={translate({ message: "Saving collection behavior" })}
          message={error}
          recovery={t({
            message:
              "Your unsaved choices are still here. Review them and retry.",
          })}
        />
      ) : null}
      {writable && (dirty || saveState !== "idle") ? (
        <div className="settings-save-bar">
          <span role="status">
            {saveState === "saving"
              ? translate({ message: "Saving…" })
              : dirty
                ? translate({
                    message:
                      "Unsaved changes for everyone using this collection",
                  })
                : saveState === "saved"
                  ? translate({ message: "Saved with the collection." })
                  : null}
          </span>
          {dirty ? (
            <div className="settings-save-actions">
              <button
                className="secondary-action"
                disabled={saveState === "saving"}
                type="button"
                onClick={() => {
                  discard();
                  setSaveState("idle");
                  setError("");
                }}
              >
                <Trans>Discard</Trans>
              </button>
              <button
                className="primary-action"
                disabled={saveState === "saving"}
                type="submit"
              >
                <Trans>Save changes</Trans>
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}

function SettingsGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="settings-group">
      <h3 id={id}>{title}</h3>
      {children}
    </section>
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

function SettingCheckbox({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
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
      <span>
        {label}
        {description ? <small>{description}</small> : null}
      </span>
    </label>
  );
}
