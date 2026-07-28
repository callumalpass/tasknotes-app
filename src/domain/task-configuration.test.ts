import { describe, expect, it } from "vitest";

import { resolveTaskCollectionConfiguration } from "./task-configuration";

function taskType(input: Record<string, unknown>): Record<string, unknown> {
  const binding = structuredClone(
    (input.binding as Record<string, unknown> | undefined) ?? {},
  );
  const fields =
    (binding.field_roles as Record<string, string> | undefined) ?? {};
  delete binding.field_roles;
  const links = Object.fromEntries(
    Object.entries(
      (input.fields as Record<string, Record<string, unknown>> | undefined) ??
        {},
    ).flatMap(([field, definition]) => {
      const items = definition.items as Record<string, unknown> | undefined;
      const link = definition.type === "link" ? definition : items;
      return link?.type === "link"
        ? [[field, { target_type: link.target ?? "any" }]]
        : [];
    }),
  );
  return {
    ...input,
    fields: undefined,
    binding: undefined,
    collection: {
      ...((input.collection as Record<string, unknown> | undefined) ?? {}),
      ...(Object.keys(links).length ? { links } : {}),
    },
    implements: [
      {
        contract: "tasknotes.task",
        version: "0.2.0",
        fields,
        binding,
      },
    ],
  };
}

describe("TaskNotes collection configuration", () => {
  it("resolves optional capture triggers from the TaskNotes contract", () => {
    const configuration = resolveTaskCollectionConfiguration(
      taskType({
        binding: {
          nlp: {
            triggers: [
              { property_id: "tags", trigger: "##", enabled: true },
              { property_id: "priority", trigger: "!", enabled: false },
            ],
          },
        },
      }),
    );

    expect(configuration.nlp).toEqual({
      triggers: [
        { propertyId: "tags", trigger: "##", enabled: true },
        { propertyId: "priority", trigger: "!", enabled: false },
      ],
    });
  });

  it("resolves template and archive behavior from the collection contract", () => {
    const configuration = resolveTaskCollectionConfiguration(
      taskType({
        binding: {
          templating: {
            enabled: true,
            template_path: "Templates/Task.md",
            failure_mode: "error",
            unknown_variable_policy: "empty",
          },
          archive: {
            move_on_archive: true,
            folder: "Archive/Tasks",
          },
        },
      }),
    );
    expect(configuration.templating).toEqual({
      enabled: true,
      templatePath: "Templates/Task.md",
      failureMode: "error",
      unknownVariablePolicy: "empty",
    });
    expect(configuration.archive).toEqual({
      moveOnArchive: true,
      folder: "Archive/Tasks",
    });
  });

  it("resolves skipped statuses and occurrence defaults", () => {
    const configuration = resolveTaskCollectionConfiguration(
      taskType({
        binding: {
          status: {
            values: ["open", "done", "cancelled"],
            completed_values: ["done"],
            skipped_values: ["cancelled"],
            default: "open",
            default_skipped: "cancelled",
          },
          occurrences: {
            default_materialization: "rolling",
            default_next_trigger: "completion_or_skip",
            past_horizon: "P1D",
            future_horizon: "P21D",
          },
        },
      }),
    );
    expect(configuration.statuses).toMatchObject([
      { value: "open", isCompleted: false },
      { value: "done", isCompleted: true },
      { value: "cancelled", isSkipped: true },
    ]);
    expect(configuration.occurrences).toEqual({
      defaultMaterialization: "rolling",
      defaultNextTrigger: "completion_or_skip",
      pastHorizon: "P1D",
      futureHorizon: "P21D",
    });
  });

  it("resolves presentation definitions and editable schema properties", () => {
    const configuration = resolveTaskCollectionConfiguration(
      taskType({
        schema: {
          value: {
            type: "object",
            properties: {
              summary: { type: "string" },
              state: { enum: ["todo", "doing", "done"] },
              importance: { enum: ["later", "now"] },
              energy: { type: "integer", title: "Energy level", default: 2 },
              client: { type: "string" },
              reviewed: { type: "boolean", default: false },
              collaborators: {
                type: "array",
                items: { type: "string" },
              },
              internal: { type: "object" },
            },
          },
        },
        binding: {
          field_roles: {
            title: "summary",
            status: "state",
            priority: "importance",
          },
          status: {
            values: ["todo", "doing", "done"],
            completed_values: ["done"],
            default: "todo",
            definitions: [
              { value: "todo", label: "To do", order: 1 },
              {
                value: "doing",
                label: "In flight",
                order: 2,
                next_status: "done",
              },
              { value: "done", label: "Finished", order: 3 },
            ],
          },
          priority: {
            values: ["later", "now"],
            default: "later",
            definitions: [
              { value: "later", label: "Whenever", weight: 1 },
              { value: "now", label: "Right now", weight: 9 },
            ],
          },
        },
      }),
    );

    expect(configuration.statuses).toMatchObject([
      { value: "todo", label: "To do", order: 1 },
      { value: "doing", label: "In flight", order: 2, nextStatus: "done" },
      { value: "done", label: "Finished", order: 3, isCompleted: true },
    ]);
    expect(configuration.priorities).toMatchObject([
      { value: "later", label: "Whenever", weight: 1 },
      { value: "now", label: "Right now", weight: 9 },
    ]);
    expect(configuration.userFields).toEqual([
      {
        id: "schema:energy",
        key: "energy",
        displayName: "Energy level",
        type: "number",
        defaultValue: 2,
      },
      {
        id: "schema:client",
        key: "client",
        displayName: "Client",
        type: "text",
      },
      {
        id: "schema:reviewed",
        key: "reviewed",
        displayName: "Reviewed",
        type: "boolean",
        defaultValue: false,
      },
      {
        id: "schema:collaborators",
        key: "collaborators",
        displayName: "Collaborators",
        type: "list",
      },
    ]);
  });

  it("derives value and record completion from the collection schema", () => {
    const configuration = resolveTaskCollectionConfiguration(
      taskType({
        schema: {
          value: {
            type: "object",
            properties: {
              contexts: {
                type: "array",
                items: { enum: ["computer", "errands"] },
              },
            },
          },
        },
        fields: {
          projects: {
            type: "list",
            items: { type: "link", target: "project" },
          },
        },
        binding: {
          links: { write_format: "markdown" },
        },
      }),
    );

    expect(configuration.fieldCompletions.contexts).toEqual({
      kind: "values",
      values: [{ value: "computer" }, { value: "errands" }],
    });
    expect(configuration.fieldCompletions.projects).toEqual({
      kind: "records",
      targetTypes: ["project"],
    });
    expect(configuration.linkWriteFormat).toBe("markdown");
  });

  it("preserves required, read-only, enum, and date-time schema semantics", () => {
    const configuration = resolveTaskCollectionConfiguration(
      taskType({
        schema: {
          value: {
            type: "object",
            required: ["owner", "reviewedAt"],
            properties: {
              owner: {
                type: "string",
                title: "Owner",
                enum: ["Alex", "Sam"],
              },
              reviewedAt: {
                type: "string",
                format: "date-time",
              },
              externalId: {
                type: "string",
                readOnly: true,
              },
            },
          },
        },
        binding: {},
      }),
    );

    expect(configuration.userFields).toEqual([
      {
        id: "schema:owner",
        key: "owner",
        displayName: "Owner",
        type: "text",
        required: true,
        inputKind: "enum",
        options: [{ value: "Alex" }, { value: "Sam" }],
      },
      {
        id: "schema:reviewedAt",
        key: "reviewedAt",
        displayName: "Reviewed At",
        type: "text",
        required: true,
        inputKind: "datetime",
      },
      {
        id: "schema:externalId",
        key: "externalId",
        displayName: "External Id",
        type: "text",
        readOnly: true,
      },
    ]);
  });
});
