import { describe, expect, it } from "vitest";

import { defaultTaskCollectionConfiguration } from "./task-configuration";
import { viewGroupMoveInput, viewPropertyMoveInput } from "./view-mutation";

import type { Task } from "./task";

describe("view property moves", () => {
  it("shares scalar property mutation across view presentations", () => {
    expect(
      viewPropertyMoveInput({
        task: task(),
        property: "note.status",
        destinationValue: "done",
        configuration: defaultTaskCollectionConfiguration(),
      }),
    ).toEqual({ status: "done" });
  });

  it("moves list group membership while preserving unrelated values", () => {
    expect(
      viewGroupMoveInput(
        task({ projects: ["work", "mobile"] }),
        { projects: "work" },
        { projects: "personal" },
        defaultTaskCollectionConfiguration(),
      ),
    ).toEqual({ projects: ["mobile", "personal"] });
  });

  it("removes the source membership when moving into an ungrouped lane", () => {
    expect(
      viewGroupMoveInput(
        task({ contexts: ["work", "home"] }),
        { contexts: "work" },
        { contexts: null },
        defaultTaskCollectionConfiguration(),
      ),
    ).toEqual({ contexts: ["home"] });
  });

  it("rejects calculated group destinations", () => {
    expect(
      viewGroupMoveInput(
        task(),
        { "formula.score": "low" },
        { "formula.score": "high" },
        defaultTaskCollectionConfiguration(),
      ),
    ).toBeNull();
  });

  it("combines mutations when a view groups by multiple custom properties", () => {
    const configuration = defaultTaskCollectionConfiguration();
    configuration.userFields = [
      {
        id: "teams",
        key: "teams",
        displayName: "Teams",
        type: "list",
      },
      {
        id: "phase",
        key: "phase",
        displayName: "Phase",
        type: "text",
      },
    ];

    expect(
      viewGroupMoveInput(
        task({
          customProperties: {
            teams: ["mobile", "platform"],
            phase: "build",
          },
        }),
        { teams: "mobile", phase: "build" },
        { teams: "web", phase: "ship" },
        configuration,
      ),
    ).toEqual({
      customProperties: {
        teams: ["platform", "web"],
        phase: "ship",
      },
    });
  });
});

function task(patch: Partial<Task> = {}): Task {
  return {
    id: "task",
    path: "tasks/task.md",
    title: "Task",
    status: "open",
    completed: false,
    archived: false,
    priority: "normal",
    body: "",
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
    tags: [],
    contexts: [],
    projects: [],
    blockedBy: [],
    completeInstances: [],
    skippedInstances: [],
    reminders: [],
    timeEntries: [],
    customProperties: {},
    revision: 1,
    frontmatter: {},
    ...patch,
    attachments: patch.attachments ?? [],
  };
}
