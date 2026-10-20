import { Clipboard, FileText, Link2 } from "lucide-react";
import { useEffect, useState } from "react";

import { taskRecordLink } from "../domain/task-links";
import { actionFeedback } from "../native/feedback";
import { writeClipboard } from "../native/clipboard";

import type { TaskSummary } from "../domain/task";

type Copied = "path" | "link" | "failed";

/** The task's Markdown file: where it lives and how to point at it. */
export function TaskRecordFile({
  task,
  linkFormat,
}: {
  task: Pick<TaskSummary, "path" | "title" | "frontmatter">;
  linkFormat: "wikilink" | "markdown";
}) {
  const [copied, setCopied] = useState<Copied | null>(null);
  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(null), 2400);
    return () => window.clearTimeout(timeout);
  }, [copied]);
  if (!task.path) return null;
  const link = taskRecordLink(task, linkFormat);
  const linkLabel = linkFormat === "markdown" ? "Markdown link" : "wikilink";

  async function copy(kind: "path" | "link", value: string) {
    try {
      await writeClipboard(value);
      actionFeedback();
      setCopied(kind);
    } catch {
      setCopied("failed");
    }
  }

  return (
    <section className="record-file" aria-label="Markdown file">
      <p className="record-file-path">
        <FileText aria-hidden="true" size={16} />
        <code title={task.path}>{task.path}</code>
      </p>
      <div className="record-file-actions">
        <button type="button" onClick={() => void copy("path", task.path)}>
          <Clipboard aria-hidden="true" size={16} />
          Copy path
        </button>
        <button type="button" onClick={() => void copy("link", link)}>
          <Link2 aria-hidden="true" size={16} />
          Copy {linkLabel}
        </button>
        <span className="record-file-status" role="status">
          {copied === "path"
            ? "Path copied"
            : copied === "link"
              ? `${linkLabel[0].toUpperCase()}${linkLabel.slice(1)} copied`
              : copied === "failed"
                ? "Couldn’t copy"
                : ""}
        </span>
      </div>
    </section>
  );
}
