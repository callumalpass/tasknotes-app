import { buildTaskNotesMdbaseResources } from "@tasknotes/model/mdbase";
import { describe, expect, it } from "vitest";

import { resolveTaskCollectionConfiguration } from "./task-configuration";
import {
  TaskVocabularyError,
  customFieldKey,
  patchTaskTypeVocabulary,
  vocabularyInUse,
  vocabularyValue,
  type TaskStatusEdit,
} from "./task-type-vocabulary";

function taskType(): Record<string, unknown> {
  return structuredClone(buildTaskNotesMdbaseResources({}).type) as Record<
    string,
    unknown
  >;
}

function statuses(type: Record<string, unknown>): TaskStatusEdit[] {
  return resolveTaskCollectionConfiguration(type).statuses.map(
    ({ value, label, color, isCompleted }) => ({
      value,
      label,
      color,
      isCompleted,
    }),
  );
}

function path(value: unknown, ...keys: Array<string | number>): unknown {
  return keys.reduce<unknown>(
    (current, key) => (current as Record<string | number, unknown>)?.[key],
    value,
  );
}

describe("patchTaskTypeVocabulary", () => {
  it("adds, relabels and reorders statuses everywhere the type names them", () => {
    const type = taskType();
    const [none, open, progress, done] = statuses(type);
    const patched = patchTaskTypeVocabulary(type, {
      statuses: [
        open!,
        {
          value: "waiting",
          label: "Waiting",
          color: "#aa00aa",
          isCompleted: false,
        },
        { ...progress!, label: "Doing" },
        done!,
        {
          value: "dropped",
          label: "Dropped",
          color: "#333333",
          isCompleted: true,
        },
        none!,
      ],
    });

    const values = [
      "open",
      "waiting",
      "in-progress",
      "done",
      "dropped",
      "none",
    ];
    expect(
      path(patched, "schema", "value", "properties", "status", "enum"),
    ).toEqual(values);
    expect(
      path(
        patched,
        "schema",
        "value",
        "allOf",
        0,
        "if",
        "properties",
        "status",
        "enum",
      ),
    ).toEqual(["done", "dropped"]);
    const configuration = resolveTaskCollectionConfiguration(patched);
    expect(configuration.statuses.map(({ value }) => value)).toEqual(values);
    expect(
      configuration.statuses.map(({ label, isCompleted }) => [
        label,
        isCompleted,
      ]),
    ).toEqual([
      ["Open", false],
      ["Waiting", false],
      ["Doing", false],
      ["Done", true],
      ["Dropped", true],
      ["None", false],
    ]);
    expect(configuration.statuses[1]).toMatchObject({ color: "#aa00aa" });
    expect(configuration.defaults.status).toBe("open");
    // The original is untouched and unrelated parts are carried over.
    expect(
      path(type, "schema", "value", "properties", "status", "enum"),
    ).toHaveLength(4);
    expect(patched.lifecycle).toEqual(type.lifecycle);
    expect(path(patched, "implements", 0, "binding", "priority")).toEqual(
      path(type, "implements", 0, "binding", "priority"),
    );
  });

  it("moves the default with a status that is removed in the same save", () => {
    const type = taskType();
    const remaining = statuses(type).filter(({ value }) => value !== "open");
    expect(() =>
      patchTaskTypeVocabulary(type, { statuses: remaining }),
    ).toThrow(TaskVocabularyError);
    const patched = patchTaskTypeVocabulary(
      type,
      { statuses: remaining },
      { status: "in-progress" },
    );
    expect(resolveTaskCollectionConfiguration(patched).defaults.status).toBe(
      "in-progress",
    );
    expect(path(patched, "collection", "read_defaults", "status")).toBe(
      "in-progress",
    );
    expect(
      path(patched, "schema", "value", "properties", "status", "default"),
    ).toBe("in-progress");
  });

  it("refuses lists a collection could not work with", () => {
    const type = taskType();
    const all = statuses(type);
    const problem = (run: () => unknown) => {
      try {
        run();
      } catch (reason) {
        return (reason as TaskVocabularyError).problem;
      }
      return null;
    };
    expect(
      problem(() =>
        patchTaskTypeVocabulary(type, {
          statuses: all.filter((status) => !status.isCompleted),
        }),
      ),
    ).toEqual({ kind: "no-completed-status" });
    expect(
      problem(() =>
        patchTaskTypeVocabulary(
          type,
          { statuses: all.filter((status) => status.isCompleted) },
          { status: "done" },
        ),
      ),
    ).toEqual({ kind: "no-open-status" });
    expect(
      problem(() =>
        patchTaskTypeVocabulary(type, { statuses: [...all, { ...all[0]! }] }),
      ),
    ).toEqual({ kind: "duplicate-value", list: "status", value: "none" });
    expect(
      problem(() =>
        patchTaskTypeVocabulary(type, {
          statuses: all.map((status) =>
            status.value === "done" ? { ...status, label: " " } : status,
          ),
        }),
      ),
    ).toEqual({ kind: "empty-label", list: "status" });
    expect(
      problem(() => patchTaskTypeVocabulary(type, { priorities: [] })),
    ).toEqual({
      kind: "no-priority",
    });
  });

  it("orders priorities by position and keeps what it does not edit", () => {
    const type = taskType();
    const patched = patchTaskTypeVocabulary(type, {
      priorities: [
        { value: "low", label: "Someday", color: "#00aa00" },
        { value: "normal", label: "Normal", color: "#ffaa00" },
        { value: "urgent", label: "Urgent", color: "#990000" },
      ],
    });
    const configuration = resolveTaskCollectionConfiguration(patched);
    expect(
      configuration.priorities.map(({ value, label, weight }) => [
        value,
        label,
        weight,
      ]),
    ).toEqual([
      ["low", "Someday", 0],
      ["normal", "Normal", 1],
      ["urgent", "Urgent", 2],
    ]);
    expect(
      path(patched, "schema", "value", "properties", "priority", "enum"),
    ).toEqual(["low", "normal", "urgent"]);
    expect(configuration.statuses).toEqual(
      resolveTaskCollectionConfiguration(type).statuses,
    );
  });

  it("adds, renames and removes custom fields without touching other properties", () => {
    const type = taskType();
    const added = patchTaskTypeVocabulary(type, {
      customFields: {
        add: [
          { key: "effort", displayName: "Effort", type: "number" },
          { key: "client_name", displayName: "Client", type: "text" },
          { key: "review_on", displayName: "Review on", type: "date" },
          { key: "billable", displayName: "Billable", type: "boolean" },
          { key: "people", displayName: "People", type: "list" },
        ],
      },
    });
    expect(
      resolveTaskCollectionConfiguration(added).userFields.map(
        ({ key, displayName, type }) => [key, displayName, type],
      ),
    ).toEqual([
      ["effort", "Effort", "number"],
      ["client_name", "Client", "text"],
      ["review_on", "Review on", "date"],
      ["billable", "Billable", "boolean"],
      ["people", "People", "list"],
    ]);

    const changed = patchTaskTypeVocabulary(added, {
      customFields: {
        rename: [{ key: "client_name", displayName: "Customer" }],
        remove: ["billable", "status"],
      },
    });
    expect(
      resolveTaskCollectionConfiguration(changed).userFields.map(
        ({ key, displayName }) => [key, displayName],
      ),
    ).toEqual([
      ["effort", "Effort"],
      ["client_name", "Customer"],
      ["review_on", "Review on"],
      ["people", "People"],
    ]);
    // A task role is never removed as though it were a custom field.
    expect(
      path(changed, "schema", "value", "properties", "status"),
    ).toBeDefined();
  });

  it("refuses a custom field whose name is unusable or already taken", () => {
    const type = taskType();
    const add = (key: string) => () =>
      patchTaskTypeVocabulary(type, {
        customFields: { add: [{ key, displayName: "Field", type: "text" }] },
      });
    expect(add("two words")).toThrow(TaskVocabularyError);
    expect(add("Due")).toThrow(TaskVocabularyError);
    expect(add("timeEstimate")).toThrow(TaskVocabularyError);
    expect(add("tags")).toThrow(TaskVocabularyError);
  });
});

describe("vocabularyInUse", () => {
  const current = { statuses: ["open", "done"], priorities: ["low", "high"] };
  const tasks = [
    { status: "open", priority: "low" },
    { status: "open", priority: "high" },
    { status: "done", priority: "high" },
  ];

  it("names a removed value that tasks still hold, with their number", () => {
    const problem = vocabularyInUse(tasks, current, {
      statuses: [
        { value: "done", label: "Done", color: "", isCompleted: true },
      ],
    });
    expect(problem).toMatchObject({ list: "status", value: "open", count: 2 });
    expect(
      vocabularyInUse(tasks, current, {
        priorities: [{ value: "low", label: "Low", color: "" }],
      }),
    ).toMatchObject({ list: "priority", value: "high", count: 2 });
  });

  it("allows removing values no task holds", () => {
    expect(
      vocabularyInUse([{ status: "open", priority: "low" }], current, {
        statuses: [
          { value: "open", label: "Open", color: "", isCompleted: false },
        ],
        priorities: [{ value: "low", label: "Low", color: "" }],
      }),
    ).toBeNull();
    expect(vocabularyInUse(tasks, current, {})).toBeNull();
  });
});

describe("generated names", () => {
  it("makes a stored value from a label and avoids ones in use", () => {
    expect(vocabularyValue("In Review", [])).toBe("in-review");
    expect(vocabularyValue("  Écrire!  ", [])).toBe("ecrire");
    expect(vocabularyValue("Open", ["open", "open-2"])).toBe("open-3");
    expect(vocabularyValue("保留", [])).toBe("保留");
    expect(vocabularyValue("???", [])).toBe("option");
  });

  it("makes a property name from a field label", () => {
    expect(customFieldKey("Client name", [])).toBe("client_name");
    expect(customFieldKey("2nd pass", [])).toBe("_2nd_pass");
    expect(customFieldKey("Effort", ["effort", "Effort_2"])).toBe("effort_3");
    expect(customFieldKey("保留", [])).toBe("field");
  });
});
