import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  readViewDraft,
  removeViewFromDocument,
  updateViewDocument,
} from "./view-document";
import { createPlanForView } from "./view-creation";
import { defaultTaskCollectionConfiguration } from "./task-configuration";
import type {
  TaskView,
  TaskViewDeclarationSelector,
  TaskViewSourceDocument,
} from "./view";

// Producer-shaped metadata stand-ins only; no native READ or grant proof.
const selector: TaskViewDeclarationSelector = {
  recordId: "00000000-0000-0000-0000-000000000001",
  path: "tasks.base",
  revision: "sha256:" + "ab".repeat(32),
  ordinal: 2,
  name: "Same",
};
const text = `unknown: retained
views:
  - ignored
  - name: Same
    type: table
    sort:
      - property: status
        direction: asc
  - name: Same
    type: tasknotesTaskList
    sort:
      - property: due
        direction: desc
    options:
      create:
        defaults:
          priority: high
`;
const source: TaskViewSourceDocument = {
  recordId: selector.recordId,
  path: selector.path,
  revision: selector.revision,
  format: "obsidian.base",
  document: text,
};
const view: TaskView = {
  key: `${selector.recordId}#2`,
  documentId: selector.recordId,
  documentName: "tasks",
  id: "2",
  name: "Same",
  declaration: selector,
  properties: [],
  source: {
    path: selector.path,
    revision: selector.revision,
    format: source.format,
    writable: false,
  },
};

describe("explicit view declaration selection", () => {
  it("uses the original ordinal without filtering entries or matching repeated names", () => {
    const draft = readViewDraft(source, view.id, selector);
    expect(draft.sort).toEqual([{ property: "due", direction: "desc" }]);
    expect(draft.declaration).toEqual(selector);
    expect(draft.declaration).not.toBe(selector);
    expect(() => readViewDraft(source, view.id)).toThrow("no longer");
    expect(
      createPlanForView(view, source, defaultTaskCollectionConfiguration())
        .defaults.priority,
    ).toBe("high");
  });
  it("updates only the selected declaration while retaining other entries and unknown fields", () => {
    const draft = readViewDraft(source, view.id, selector);
    draft.name = "Changed";
    const updated = parse(updateViewDocument(source, draft));
    expect(updated.unknown).toBe("retained");
    expect(updated.views[0]).toBe("ignored");
    expect(updated.views[1]).toEqual(parse(text).views[1]);
    expect(updated.views[2].name).toBe("Changed");
  });
  it("removes the original declaration rather than its repeated-name neighbour", () => {
    const result = removeViewFromDocument(source, view.id, selector);
    expect(result.deleteSource).toBe(false);
    expect(parse(result.document!).views).toEqual(
      parse(text).views.slice(0, 2),
    );
  });
  it.each([-1, 0.5, NaN, Infinity, 0x100000000, 3])(
    "refuses ordinal %s without a name fallback",
    (ordinal) => {
      expect(() =>
        readViewDraft(source, "same", { ...selector, ordinal }),
      ).toThrow();
    },
  );
  it.each(["recordId", "path", "revision"] as const)(
    "refuses a different source %s",
    (field) => {
      const changed = { ...source, [field]: "different" };
      const draft = readViewDraft(source, view.id, selector);
      expect(() => readViewDraft(changed, view.id, selector)).toThrow(
        "source changed",
      );
      expect(() => updateViewDocument(changed, draft)).toThrow(
        "source changed",
      );
      expect(() => removeViewFromDocument(changed, view.id, selector)).toThrow(
        "source changed",
      );
    },
  );
  it("does not infer a missing record identity from a path", () => {
    expect(() =>
      readViewDraft({ ...source, recordId: undefined }, view.id, selector),
    ).toThrow("source changed");
  });
  it("refuses declaration drift even if the caller repeats the revision metadata", () => {
    const changed = {
      ...source,
      document: text.replace(
        "  - name: Same\n    type: tasknotesTaskList",
        "  - name: Different\n    type: tasknotesTaskList",
      ),
    };
    expect(() => readViewDraft(changed, view.id, selector)).toThrow();
    expect(() =>
      removeViewFromDocument(source, view.id, {
        ...selector,
        name: "Different",
      }),
    ).toThrow("original ordinal");
  });
  it("reads and updates frontmatter-backed sources without changing their Markdown body", () => {
    const body = "# Body\r\nExact trailing spaces  \r\n";
    const markdown = { ...source, document: `---\n${text}---\n${body}` };
    const draft = readViewDraft(markdown, view.id, selector);
    expect(draft.sort).toEqual([{ property: "due", direction: "desc" }]);
    expect(
      createPlanForView(view, markdown, defaultTaskCollectionConfiguration())
        .defaults.priority,
    ).toBe("high");
    draft.name = "Changed";
    expect(updateViewDocument(markdown, draft).endsWith(`---\n${body}`)).toBe(
      true,
    );
    expect(
      removeViewFromDocument(markdown, view.id, selector).document!.endsWith(
        `---\n${body}`,
      ),
    ).toBe(true);
  });
  it("preserves legacy stable-ID selection when no positional selector is supplied", () => {
    expect(
      readViewDraft({ ...source, recordId: undefined }, "same-2").sort,
    ).toEqual([{ property: "due", direction: "desc" }]);
  });
  it("handles an explicitly selected unnamed declaration without inventing a name selector", () => {
    const unnamed = {
      ...source,
      document: "views:\n  - type: tasknotesTaskList\n",
    };
    expect(
      readViewDraft(unnamed, "0", { ...selector, ordinal: 0, name: null }).name,
    ).toBe("View");
  });
});
