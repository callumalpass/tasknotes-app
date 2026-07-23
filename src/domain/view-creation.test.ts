import { describe, expect, it } from "vitest";

import { defaultTaskCollectionConfiguration } from "./task-configuration";
import { createPlanForView, mergeTaskCreationDefaults } from "./view-creation";

import type { TaskView, TaskViewSourceDocument } from "./view";

describe("saved view task creation", () => {
  it("infers equalities and positive list membership from shared and view filters", () => {
    const source = baseSource(`filters:
  and:
    - archived == false
    - projects.contains("mdbase")
views:
  - type: tasknotesTaskList
    name: Open work
    filters:
      and:
        - status == "open"
        - tags.contains("work")
`);
    const plan = createPlanForView(
      view(),
      source,
      defaultTaskCollectionConfiguration(),
    );

    expect(plan.defaults).toEqual({
      status: "open",
      projects: ["mdbase"],
      tags: ["work"],
    });
    expect(plan.inferredProperties).toEqual([
      "archived",
      "projects",
      "status",
      "tags",
    ]);
  });

  it("does not guess a value from disjunctions or non-reversible conditions", () => {
    const source = baseSource(`views:
  - type: tasknotesTaskList
    name: Open work
    filters:
      and:
        - { or: ['status == "open"', 'status == "waiting"'] }
        - due > today()
        - projects.contains("mdbase")
`);
    const plan = createPlanForView(
      view(),
      source,
      defaultTaskCollectionConfiguration(),
    );

    expect(plan.defaults).toEqual({ projects: ["mdbase"] });
  });

  it("does not treat string contains as a list-membership default", () => {
    const configuration = defaultTaskCollectionConfiguration();
    configuration.userFields = [
      ...configuration.userFields,
      {
        id: "owner",
        key: "owner",
        displayName: "Owner",
        type: "text",
      },
    ];
    const source = baseSource(`views:
  - type: tasknotesTaskList
    name: Open work
    filters: owner.contains("Callum")
`);

    expect(createPlanForView(view(), source, configuration).defaults).toEqual(
      {},
    );
  });

  it("lets explicit view creation defaults override inferred scalars", () => {
    const source = baseSource(`views:
  - type: tasknotesTaskList
    name: Open work
    filters: status == "open"
    options:
      create:
        defaults:
          status: waiting
          priority: high
          projects: [mdbase]
`);
    const plan = createPlanForView(
      view(),
      source,
      defaultTaskCollectionConfiguration(),
    );

    expect(plan.defaults).toEqual({
      status: "waiting",
      priority: "high",
      projects: ["mdbase"],
    });
    expect(plan.explicitProperties).toEqual(["status", "priority", "projects"]);
  });

  it("supports safe canonical CEL conjunctions and configured field names", () => {
    const configuration = defaultTaskCollectionConfiguration();
    configuration.fieldMapping.status = "state";
    const source: TaskViewSourceDocument = {
      path: "views/work.md",
      format: "mdbase.view",
      revision: "one",
      document: `---
type: view
id: work
version: 1
name: Work
query:
  types: [task]
  where: note.state == "open"
views:
  - id: open
    name: Open work
    where: note.projects.contains("mdbase") && (priority == "high" || priority == "normal")
    select: [title]
    presentation: { type: tasknotes.task-list }
---
`,
    };
    const plan = createPlanForView(
      {
        ...view(),
        id: "open",
        source: { ...view().source, path: source.path, format: source.format },
      },
      source,
      configuration,
    );

    expect(plan.defaults).toEqual({
      status: "open",
      projects: ["mdbase"],
    });
  });

  it("combines list defaults while user-entered scalar values win", () => {
    expect(
      mergeTaskCreationDefaults(
        {
          status: "open",
          tags: ["work"],
          customProperties: { team: "product", lane: "ready" },
        },
        {
          title: "Ship it",
          status: "waiting",
          tags: ["urgent", "work"],
          customProperties: { lane: "next" },
        },
      ),
    ).toEqual({
      title: "Ship it",
      status: "waiting",
      tags: ["work", "urgent"],
      customProperties: { team: "product", lane: "next" },
    });
  });
});

function baseSource(document: string): TaskViewSourceDocument {
  return {
    path: "views/work.base",
    format: "obsidian.base",
    revision: "one",
    document,
  };
}

function view(): TaskView {
  return {
    key: "views/work.base#open-work",
    documentId: "work",
    documentName: "Work",
    id: "open-work",
    name: "Open work",
    properties: [],
    source: {
      path: "views/work.base",
      format: "obsidian.base",
      revision: "one",
      writable: true,
    },
    presentation: {
      type: "tasknotes.task-list",
      mappings: {},
      options: {},
    },
  };
}
