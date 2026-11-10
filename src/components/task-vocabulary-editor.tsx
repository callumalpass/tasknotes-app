import { useLingui, Trans } from "@lingui/react/macro";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useRef, type ReactNode } from "react";

import {
  taskNotesUserFieldKey,
  taskNotesVocabularyValue,
  type TaskNotesPriorityEdit,
  type TaskNotesStatusEdit,
  type TaskNotesUserFieldEdit,
} from "@tasknotes/model/mdbase";
import { TaskNotesSelect } from "./tasknotes-controls";

import type { DraftEntry } from "./task-model-draft";
import type { UserMappedFieldType } from "@tasknotes/model/types";

const NEW_COLOR = "#808080";

function newId() {
  return `new:${crypto.randomUUID()}`;
}

function isNew(entry: { id: string }) {
  return entry.id.startsWith("new:");
}

/** A colour input needs #rrggbb; anything else keeps its stored value. */
function pickerColor(color: string) {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(color.trim());
  if (short)
    return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return /^#[0-9a-f]{6}$/i.test(color.trim()) ? color.trim() : NEW_COLOR;
}

function move<Entry>(entries: Entry[], index: number, by: -1 | 1): Entry[] {
  const target = index + by;
  if (target < 0 || target >= entries.length) return entries;
  const next = [...entries];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

type Named = { id: string; value: string; label: string; color: string };

/** Shared rows for statuses and priorities: colour, name, order and removal. */
function OptionRows<Entry extends Named>({
  entries,
  defaultValue,
  nameLabel,
  extra,
  onChange,
  onDefault,
}: {
  entries: Entry[];
  defaultValue: string;
  nameLabel: string;
  extra?(entry: Entry, change: (patch: Partial<Entry>) => void): ReactNode;
  onChange(entries: Entry[]): void;
  onDefault(value: string): void;
}) {
  const { t } = useLingui();
  const list = useRef<HTMLUListElement>(null);
  // Moving a row keeps the keyboard on the button that moved it.
  function refocus(id: string, control: "up" | "down") {
    requestAnimationFrame(() => {
      const row = list.current?.querySelector(
        `[data-entry="${CSS.escape(id)}"]`,
      );
      const button =
        row?.querySelector<HTMLButtonElement>(
          `[data-move="${control}"]:not(:disabled)`,
        ) ??
        row?.querySelector<HTMLButtonElement>("[data-move]:not(:disabled)");
      button?.focus();
    });
  }
  return (
    <ul className="vocabulary-list" ref={list}>
      {entries.map((entry, index) => {
        const name = entry.label.trim() || nameLabel;
        const isDefault = entry.value === defaultValue;
        const change = (patch: Partial<Entry>) =>
          onChange(
            entries.map((candidate) =>
              candidate.id === entry.id
                ? { ...candidate, ...patch }
                : candidate,
            ),
          );
        return (
          <li className="vocabulary-row" data-entry={entry.id} key={entry.id}>
            <input
              aria-label={t`Color for ${name}`}
              className="vocabulary-color"
              type="color"
              value={pickerColor(entry.color)}
              onChange={(event) =>
                change({ color: event.target.value } as Partial<Entry>)
              }
            />
            <span className="vocabulary-name">
              <input
                aria-label={nameLabel}
                placeholder={nameLabel}
                value={entry.label}
                onChange={(event) => {
                  const label = event.target.value;
                  if (!isNew(entry)) {
                    change({ label } as Partial<Entry>);
                    return;
                  }
                  // A new entry's stored value follows its name until saved.
                  const value = taskNotesVocabularyValue(
                    label,
                    entries
                      .filter((candidate) => candidate.id !== entry.id)
                      .map((candidate) => candidate.value),
                  );
                  change({ label, value } as Partial<Entry>);
                  if (isDefault) onDefault(value);
                }}
              />
              <code>{entry.value}</code>
              {isDefault ? (
                <small>
                  <Trans>Default</Trans>
                </small>
              ) : null}
            </span>
            {extra?.(entry, change)}
            <span className="vocabulary-actions">
              <button
                aria-label={t`Move ${name} up`}
                data-move="up"
                disabled={index === 0}
                title={t`Move up`}
                type="button"
                onClick={() => {
                  onChange(move(entries, index, -1));
                  refocus(entry.id, "up");
                }}
              >
                <ArrowUp aria-hidden="true" size={17} />
              </button>
              <button
                aria-label={t`Move ${name} down`}
                data-move="down"
                disabled={index === entries.length - 1}
                title={t`Move down`}
                type="button"
                onClick={() => {
                  onChange(move(entries, index, 1));
                  refocus(entry.id, "down");
                }}
              >
                <ArrowDown aria-hidden="true" size={17} />
              </button>
              <button
                aria-label={t`Remove ${name}`}
                disabled={isDefault}
                title={
                  isDefault
                    ? t`Choose another default before removing this one.`
                    : t`Remove`
                }
                type="button"
                onClick={() =>
                  onChange(
                    entries.filter((candidate) => candidate.id !== entry.id),
                  )
                }
              >
                <Trash2 aria-hidden="true" size={17} />
              </button>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function AddButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick(): void;
}) {
  return (
    <button
      className="vocabulary-add text-action"
      type="button"
      onClick={onClick}
    >
      <Plus aria-hidden="true" size={17} />
      {children}
    </button>
  );
}

function focusLastName(list: HTMLElement | null) {
  requestAnimationFrame(() => {
    const inputs = list?.querySelectorAll<HTMLInputElement>(
      ".vocabulary-name input",
    );
    inputs?.[inputs.length - 1]?.focus();
  });
}

export function StatusListEditor({
  statuses,
  defaultStatus,
  onChange,
  onDefault,
}: {
  statuses: DraftEntry<TaskNotesStatusEdit>[];
  defaultStatus: string;
  onChange(statuses: DraftEntry<TaskNotesStatusEdit>[]): void;
  onDefault(value: string): void;
}) {
  const { t } = useLingui();
  const root = useRef<HTMLDivElement>(null);
  return (
    <div className="vocabulary-editor" ref={root}>
      <p className="setting-hint">
        <Trans>
          Shown in this order wherever a status is chosen. At least one must
          count as done.
        </Trans>
      </p>
      <OptionRows
        defaultValue={defaultStatus}
        entries={statuses}
        nameLabel={t`Status name`}
        extra={(entry, change) => (
          <label className="vocabulary-flag">
            <input
              checked={entry.isCompleted}
              type="checkbox"
              onChange={(event) =>
                change({ isCompleted: event.target.checked })
              }
            />
            <span>
              <Trans>Counts as done</Trans>
            </span>
          </label>
        )}
        onChange={onChange}
        onDefault={onDefault}
      />
      <AddButton
        onClick={() => {
          onChange([
            ...statuses,
            {
              id: newId(),
              value: taskNotesVocabularyValue(
                "",
                statuses.map(({ value }) => value),
              ),
              label: "",
              color: NEW_COLOR,
              isCompleted: false,
            },
          ]);
          focusLastName(root.current);
        }}
      >
        <Trans>Add status</Trans>
      </AddButton>
    </div>
  );
}

export function PriorityListEditor({
  priorities,
  defaultPriority,
  onChange,
  onDefault,
}: {
  priorities: DraftEntry<TaskNotesPriorityEdit>[];
  defaultPriority: string;
  onChange(priorities: DraftEntry<TaskNotesPriorityEdit>[]): void;
  onDefault(value: string): void;
}) {
  const { t } = useLingui();
  const root = useRef<HTMLDivElement>(null);
  return (
    <div className="vocabulary-editor" ref={root}>
      <p className="setting-hint">
        <Trans>Listed from lowest to highest.</Trans>
      </p>
      <OptionRows
        defaultValue={defaultPriority}
        entries={priorities}
        nameLabel={t`Priority name`}
        onChange={onChange}
        onDefault={onDefault}
      />
      <AddButton
        onClick={() => {
          onChange([
            ...priorities,
            {
              id: newId(),
              value: taskNotesVocabularyValue(
                "",
                priorities.map(({ value }) => value),
              ),
              label: "",
              color: NEW_COLOR,
            },
          ]);
          focusLastName(root.current);
        }}
      >
        <Trans>Add priority</Trans>
      </AddButton>
    </div>
  );
}

export function CustomFieldListEditor({
  fields,
  reservedKeys,
  onChange,
}: {
  fields: DraftEntry<TaskNotesUserFieldEdit>[];
  /** Property names a new field may not take. */
  reservedKeys: readonly string[];
  onChange(fields: DraftEntry<TaskNotesUserFieldEdit>[]): void;
}) {
  const { t } = useLingui();
  const root = useRef<HTMLDivElement>(null);
  const types: Array<{ value: UserMappedFieldType; label: string }> = [
    { value: "text", label: t`Text` },
    { value: "number", label: t`Number` },
    { value: "date", label: t`Date` },
    { value: "boolean", label: t`Yes or no` },
    { value: "list", label: t`List` },
  ];
  const taken = (except: string) => [
    ...reservedKeys,
    ...fields.filter(({ id }) => id !== except).map(({ key }) => key),
  ];
  return (
    <div className="vocabulary-editor" ref={root}>
      <p className="setting-hint">
        <Trans>
          Extra properties kept in each task’s file. Removing a field here
          leaves any values already in the files.
        </Trans>
      </p>
      {fields.length ? (
        <ul className="vocabulary-list">
          {fields.map((field) => {
            const name = field.displayName.trim() || t`Field name`;
            const change = (patch: Partial<TaskNotesUserFieldEdit>) =>
              onChange(
                fields.map((candidate) =>
                  candidate.id === field.id
                    ? { ...candidate, ...patch }
                    : candidate,
                ),
              );
            return (
              <li className="vocabulary-row is-field" key={field.id}>
                <span className="vocabulary-name">
                  <input
                    aria-label={t`Field name`}
                    placeholder={t`Field name`}
                    value={field.displayName}
                    onChange={(event) => {
                      const displayName = event.target.value;
                      change(
                        isNew(field)
                          ? {
                              displayName,
                              key: taskNotesUserFieldKey(
                                displayName,
                                taken(field.id),
                              ),
                            }
                          : { displayName },
                      );
                    }}
                  />
                  <code>{field.key}</code>
                </span>
                {isNew(field) ? (
                  <TaskNotesSelect
                    ariaLabel={t`Type of ${name}`}
                    className="vocabulary-type"
                    options={types}
                    value={field.type}
                    onChange={(type) =>
                      change({ type: type as UserMappedFieldType })
                    }
                  />
                ) : (
                  <span className="vocabulary-type is-fixed">
                    {types.find(({ value }) => value === field.type)?.label}
                  </span>
                )}
                <span className="vocabulary-actions">
                  <button
                    aria-label={t`Remove ${name}`}
                    title={t`Remove`}
                    type="button"
                    onClick={() =>
                      onChange(
                        fields.filter((candidate) => candidate.id !== field.id),
                      )
                    }
                  >
                    <Trash2 aria-hidden="true" size={17} />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      <AddButton
        onClick={() => {
          const id = newId();
          onChange([
            ...fields,
            {
              id,
              key: taskNotesUserFieldKey("", taken(id)),
              displayName: "",
              type: "text",
            },
          ]);
          focusLastName(root.current);
        }}
      >
        <Trans>Add field</Trans>
      </AddButton>
    </div>
  );
}
