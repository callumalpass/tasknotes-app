import "./held-edits.css";

const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  body: "Notes",
  status: "Status",
  priority: "Priority",
  due: "Due",
  scheduled: "Scheduled",
  tags: "Tags",
  contexts: "Contexts",
  projects: "Projects",
  assignees: "Assignees",
  blockedBy: "Dependencies",
  reminders: "Reminders",
  timeEstimate: "Estimate",
  customProperties: "Properties",
};

/** Edits typed on this device that mdbase had not captured when the page
 * closed. Nothing is applied until the person chooses. */
export function RecoveredEditNotice({
  fields,
  onRestore,
  onDiscard,
}: {
  fields: Record<string, unknown>;
  onRestore(): void;
  onDiscard(): void;
}) {
  const names = [
    ...new Set(
      Object.keys(fields).map((field) => FIELD_LABELS[field] ?? "Repeat"),
    ),
  ];
  const title = typeof fields.title === "string" ? fields.title : undefined;
  return (
    <section
      className="collection-held-notice recovered-edit-notice"
      role="status"
      aria-label="Unsaved edits found"
    >
      <div>
        <strong>Unsaved edits from an earlier session are available.</strong>
        <p>
          {title !== undefined ? `Title: “${title}”. ` : ""}
          Changed: {names.join(", ")}. They stay in this browser until restored
          or discarded.
        </p>
      </div>
      <div className="held-edit-actions">
        <button className="text-action" type="button" onClick={onRestore}>
          Restore unsaved edits
        </button>
        <button className="text-action" type="button" onClick={onDiscard}>
          Discard recovered edits
        </button>
      </div>
    </section>
  );
}
