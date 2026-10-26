import { Trans } from "@lingui/react/macro";
import { t as translate } from "@lingui/core/macro";
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
      aria-label={translate({ message: "Unsaved edits found" })}
    >
      <div>
        <strong>
          <Trans>Unsaved edits from an earlier session are available.</Trans>
        </strong>
        <p>
          {title !== undefined ? translate`Title: “${title}”. ` : ""}
          <Trans>Changed: </Trans>
          {names.join(", ")}
          <Trans>
            . They stay in this browser until restored or discarded.
          </Trans>
        </p>
      </div>
      <div className="held-edit-actions">
        <button className="text-action" type="button" onClick={onRestore}>
          <Trans>Restore unsaved edits</Trans>
        </button>
        <button className="text-action" type="button" onClick={onDiscard}>
          <Trans>Discard recovered edits</Trans>
        </button>
      </div>
    </section>
  );
}
