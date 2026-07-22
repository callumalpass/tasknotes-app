import { describe, expect, it } from "vitest";

import { resolveTaskCollectionConfiguration } from "./task-configuration";

describe("TaskNotes collection configuration", () => {
  it("resolves template and archive behavior from the collection contract", () => {
    const configuration = resolveTaskCollectionConfiguration({
      "x-tasknotes": {
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
    });
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

  it("resolves presentation definitions and editable schema properties", () => {
    const configuration = resolveTaskCollectionConfiguration({
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
      "x-tasknotes": {
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
    });

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
});
