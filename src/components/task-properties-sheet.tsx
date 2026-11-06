import { useLingui, Trans } from "@lingui/react/macro";
import { useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useRepository } from "../app/repository-context";
import { rememberTaskEdit } from "../app/task-edit-undo";
import { useOverlay } from "./overlays/use-overlay";
import { editableProperty, type EditableProperty } from "./task-property-kind";
import { PropertyControl } from "./task-property-editor";
import { propertyValue, updateFor } from "./task-property-input";
import type { TaskSummary } from "../domain/task";
import "./task-properties-sheet.css";

export function TaskPropertiesSheet({
  task,
  onClose,
}: {
  task: TaskSummary;
  onClose(): void;
}) {
  const { t } = useLingui();
  const { configuration } = useRepository();
  const root = useRef<HTMLElement>(null);
  const saves = useRef(Promise.resolve());
  useOverlay({ open: true, rootRef: root, modal: true, onDismiss: onClose });
  const keys = [
    "status",
    "priority",
    "scheduled",
    "due",
    "projects",
    "tags",
    "contexts",
    "recurrence",
    ...configuration.userFields.map((field) => field.key),
  ];
  const properties = keys
    .flatMap((key) => {
      const property = editableProperty(key, configuration);
      return property ? [property] : [];
    })
    .filter(
      (property, index, all) =>
        all.findIndex((other) => other.key === property.key) === index,
    );
  return createPortal(
    <div
      className="task-property-editor-scrim task-properties-sheet-scrim"
      role="presentation"
    >
      <section
        className="task-property-editor task-properties-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t`Task properties`}
        ref={root}
        tabIndex={-1}
      >
        <header>
          <div className="task-properties-sheet-heading">
            <h2>
              <Trans>Task properties</Trans>
            </h2>
            <button
              type="button"
              aria-label={t`Close property editor`}
              onClick={onClose}
            >
              <X size={19} aria-hidden="true" />
            </button>
          </div>
          <p>{task.title}</p>
        </header>
        {properties.map((property) => (
          <SheetProperty
            key={property.key}
            task={task}
            property={property}
            pendingRef={saves}
          />
        ))}
        <footer>
          <span />
          <button className="primary-action" type="button" onClick={onClose}>
            <Trans>Done</Trans>
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function SheetProperty({
  task,
  property,
  pendingRef,
}: {
  task: TaskSummary;
  property: EditableProperty;
  pendingRef: RefObject<Promise<void>>;
}) {
  const { t } = useLingui();
  const { configuration, repository, updateTask } = useRepository();
  const persistedValue = propertyValue(task, property);
  const [previousValue, setPreviousValue] = useState(persistedValue);
  const [value, setValue] = useState(persistedValue);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  if (!Object.is(previousValue, persistedValue)) {
    setPreviousValue(persistedValue);
    setValue(persistedValue);
  }
  async function save(next: unknown, anchor = task.recurrenceAnchor) {
    const previous = pendingRef.current;
    let release = () => {};
    pendingRef.current = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    setSaving(true);
    setError("");
    try {
      const before = (await repository.getSummary(task.id)) ?? task;
      const input = updateFor(before, property, next, anchor);
      const saved = await updateTask(task.id, input);
      setValue(next);
      const title = task.title;
      rememberTaskEdit({
        before,
        saved,
        input,
        notice: t`Updated “${title}”`,
        getSummary: (id) => repository.getSummary(id),
        updateTask,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      release();
      setSaving(false);
    }
  }
  return (
    <div className="task-sheet-property">
      <PropertyControl
        configuration={configuration}
        property={property}
        compactChoices
        scheduled={task.scheduled}
        due={task.due}
        anchor={task.recurrenceAnchor}
        value={value}
        disabled={saving}
        onChange={(next) => {
          setValue(next);
          if (["projects", "tags", "contexts"].includes(property.kind))
            void save(next);
        }}
        onCommit={(next) => void save(next)}
        onPersist={(next) => void save(next)}
        onAnchorChange={(anchor) => void save(value, anchor)}
      />
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
