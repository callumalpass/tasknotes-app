import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { parseFrontmatter } from "@tasknotes/model/frontmatter";
import { buildTaskNotesMdbaseResources } from "@tasknotes/model/mdbase";
import {
  compileTaskNotesQuery,
  TaskNotesQueryError,
  type TaskNotesQueryBindings,
  type TaskNotesQueryInput,
} from "../../vendor/tasknotes-query-6bec1906.browser.mjs";
import { defaultTaskCollectionConfiguration } from "../domain/task-configuration";
import {
  taskNotesDefaultBaseSources,
  taskNotesDefaultCanonicalDocument,
} from "../domain/default-view-source";
import { readViewDraft } from "../domain/view-document";

// Explicit synthetic oracle declarations, NOT native catalogue/context proof.
const syntheticBindings: TaskNotesQueryBindings = {
  types: ["task"],
  fields: {
    status: "status",
    priority: "priority",
    archived: "archived",
    due: "due",
  },
  filterQueryBasis: "raw",
  nativeTimestampFields: ["due", "scheduled", "plan_date", "deadline"],
  basesTypedFields: [
    "due",
    "scheduled",
    "projects",
    "contexts",
    "tags",
    "plan_date",
    "deadline",
    "project_links",
  ],
};

const defaults = defaultTaskCollectionConfiguration();
const custom = structuredClone(defaults);
custom.fieldMapping = {
  ...custom.fieldMapping,
  status: "workflow_state",
  priority: "importance",
  scheduled: "plan_date",
  due: "deadline",
  projects: "project_links",
};
custom.statuses = custom.statuses.map((status, index) => ({
  ...status,
  value: `custom-state-${index}`,
}));
custom.priorities = custom.priorities.map((priority, index) => ({
  ...priority,
  value: `custom-priority-${index}`,
}));
custom.defaults.status =
  custom.statuses[
    defaults.statuses.findIndex((s) => s.value === defaults.defaults.status)
  ]!.value;
custom.defaults.priority =
  custom.priorities[
    defaults.priorities.findIndex((p) => p.value === defaults.defaults.priority)
  ]!.value;

const cases: Array<{
  name: string;
  input: TaskNotesQueryInput;
  bindings: TaskNotesQueryBindings;
}> = [];
for (const [profile, config] of [
  ["default", defaults],
  ["custom", custom],
] as const) {
  // Catch invalid fixture vocabularies through the actual shared producer.
  buildTaskNotesMdbaseResources({
    profiles: ["core-lite"],
    modelConfig: config,
  });
  const bindings = {
    ...syntheticBindings,
    fields: Object.fromEntries(
      Object.values(config.fieldMapping).map((field) => [field, field]),
    ),
  };
  for (const source of taskNotesDefaultBaseSources(config)) {
    const doc = {
      path: source.path,
      format: "obsidian.base" as const,
      revision: "synthetic",
      document: source.document,
    };
    const draft = readViewDraft(doc, source.name.toLowerCase());
    cases.push({
      name: `${profile}/Bases/${source.name}`,
      bindings,
      input: {
        dialect: "obsidian-bases",
        filter: draft.filter,
        globalFilter: (parse(doc.document) as { filters?: unknown }).filters,
        sort: draft.sort,
        groupProperty: draft.groupProperty,
        computedProperties: draft.computedProperties,
        properties: draft.properties,
      },
    });
  }
  const doc = {
    path: "synthetic.view",
    format: "mdbase.view" as const,
    revision: "synthetic",
    document: taskNotesDefaultCanonicalDocument(config),
  };
  for (const view of parseFrontmatter(doc.document).frontmatter.views as Array<{
    id: string;
    name: string;
  }>) {
    const draft = readViewDraft(doc, view.id);
    cases.push({
      name: `${profile}/canonical/${view.name}`,
      bindings,
      input: { dialect: "mdbase-cel", filter: draft.filter },
    });
  }
}

describe("shared compiler artifact intake (synthetic declarations, not native/Core/LAB qualification)", () => {
  it("preserves source-global AND view predicates and exact raw dependencies", () => {
    expect(cases).toHaveLength(20);
    const result = compileTaskNotesQuery(
      {
        dialect: "obsidian-bases",
        globalFilter: 'note.priority != "none"',
        filter: 'note.status == "open"',
      },
      syntheticBindings,
    );
    expect(result.query.types).toEqual(["task"]);
    expect(result.query.where).toContain("&&");
    expect(result.query.where).toContain('"priority" in raw');
    expect(result.query.where).toContain('"status" in raw');
    expect(result.dependencies).toEqual(
      expect.arrayContaining([
        { source: "raw", field: "priority" },
        { source: "raw", field: "status" },
      ]),
    );
    expect(result.requiresReplicaValidation).toBe(true);
  });

  it("refuses boolean field comparisons outside the published scalar frontier", () => {
    expect(() =>
      compileTaskNotesQuery(
        { dialect: "obsidian-bases", filter: "note.archived != true" },
        syntheticBindings,
      ),
    ).toThrow("unsupported_expression");
  });

  it("refuses absent producer typing rather than filling empty declarations", () => {
    const {
      nativeTimestampFields: _timestamps,
      basesTypedFields: _types,
      ...unproven
    } = syntheticBindings;
    void _timestamps;
    void _types;
    expect(() =>
      compileTaskNotesQuery(
        { dialect: "obsidian-bases", filter: 'note.status == "open"' },
        unproven as TaskNotesQueryBindings,
      ),
    ).toThrow("invalid_input");
  });

  it("refuses native Timestamp expressions even when a field name is mapped", () => {
    expect(() =>
      compileTaskNotesQuery(
        { dialect: "obsidian-bases", filter: 'note.due == "2026-10-06"' },
        syntheticBindings,
      ),
    ).toThrow("unsupported_expression");
  });

  it("does not silently rename a Bases raw field to a TaskNotes alias", () => {
    expect(() =>
      compileTaskNotesQuery(
        { dialect: "obsidian-bases", filter: 'note.status == "open"' },
        { ...syntheticBindings, fields: { status: "workflow_state" } },
      ),
    ).toThrow("unsupported_field");
  });

  it("does not drop unsupported view options or infer another dialect", () => {
    expect(() =>
      compileTaskNotesQuery(
        {
          dialect: "obsidian-bases",
          filter: 'note.status == "open"',
          sourcePath: "synthetic.base",
        } as TaskNotesQueryInput,
        syntheticBindings,
      ),
    ).toThrow("invalid_input");
    expect(() =>
      compileTaskNotesQuery(
        {
          dialect: "tasknotes-filter",
          filter: {
            type: "group",
            id: "synthetic",
            conjunction: "and",
            children: [],
          },
        },
        syntheticBindings,
      ),
    ).toThrow("unsupported_dialect");
  });

  it.each(cases)(
    "explicitly refuses the current $name starter frontier",
    ({ input, bindings }) => {
      expect(() => compileTaskNotesQuery(input, bindings)).toThrow(
        TaskNotesQueryError,
      );
      try {
        compileTaskNotesQuery(input, bindings);
      } catch (error) {
        expect(error).toBeInstanceOf(TaskNotesQueryError);
        expect((error as TaskNotesQueryError).code).toMatch(/^unsupported_/);
      }
    },
  );
});
