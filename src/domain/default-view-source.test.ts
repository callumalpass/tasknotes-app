import { parse } from "yaml";
import { describe, expect, it, vi } from "vitest";

import { defaultTaskCollectionConfiguration } from "./task-configuration";
import {
  defaultNavigationViewKeys,
  ensureTaskNotesDefaultViewSource,
  taskNotesDefaultBaseDocument,
} from "./default-view-source";

import type { TaskViewDocument } from "./view";
import type { TaskRepository } from "../storage/repository";

describe("TaskNotes starter views", () => {
  it("writes the starter task and project views to one editable Base source", () => {
    const parsed = parse(
      taskNotesDefaultBaseDocument(defaultTaskCollectionConfiguration()),
    ) as {
      views: Array<{
        name: string;
        type: string;
        options?: Record<string, unknown>;
      }>;
    };

    expect(parsed.views.map(({ name, type }) => [name, type])).toEqual([
      ["Today", "tasknotesTaskList"],
      ["Upcoming", "tasknotesCalendar"],
      ["Calendar", "tasknotesCalendar"],
      ["Projects", "tasknotesProjects"],
    ]);
    expect(parsed.views[1].options).toMatchObject({
      calendarView: "listWeek",
      showRecurring: true,
    });
    expect(parsed.views[2].options).toMatchObject({
      calendarView: "dayGridMonth",
      showRecurring: true,
    });
  });

  it("creates the Base once and returns the provider-owned definitions", async () => {
    const created = starterDocument();
    const repository = {
      createViewSource: vi.fn(async () => ({
        path: created.source.path,
        format: "obsidian.base",
        revision: "1",
        document: "",
      })),
      listViews: vi.fn(async () => [created]),
      syncStatus: vi.fn(),
    } as unknown as TaskRepository;

    await expect(
      ensureTaskNotesDefaultViewSource(
        repository,
        [],
        defaultTaskCollectionConfiguration(),
      ),
    ).resolves.toEqual([created]);
    expect(repository.createViewSource).toHaveBeenCalledWith(
      expect.objectContaining({
        format: "obsidian.base",
        name: "tasknotes-app",
      }),
    );

    await ensureTaskNotesDefaultViewSource(
      repository,
      [created],
      defaultTaskCollectionConfiguration(),
    );
    expect(repository.createViewSource).toHaveBeenCalledTimes(1);
  });

  it("adds Projects once to an older managed starter Base and marks the migration", async () => {
    const current = starterDocument();
    const older = { ...current, views: current.views.slice(0, 3) };
    const source = taskNotesDefaultBaseDocument(
      defaultTaskCollectionConfiguration(),
    ).replace(/x-tasknotes-app:\n[ ]{2}version: 2\n/, "");
    const updateViewSource = vi.fn(
      async (input: import("./view").UpdateTaskViewSourceInput) => ({
        path: older.source.path,
        format: "obsidian.base",
        revision: "2",
        document: input.document,
      }),
    );
    const repository = {
      readViewSource: vi.fn(async () => ({
        path: older.source.path,
        format: "obsidian.base",
        revision: "1",
        document: source.split("\n  - type: tasknotesProjects", 1).join(""),
      })),
      updateViewSource,
      listViews: vi.fn(async () => [current]),
    } as unknown as TaskRepository;

    await expect(
      ensureTaskNotesDefaultViewSource(
        repository,
        [older],
        defaultTaskCollectionConfiguration(),
      ),
    ).resolves.toEqual([current]);
    expect(updateViewSource).toHaveBeenCalledOnce();
    const updated = updateViewSource.mock.calls[0][0].document;
    expect(updated).toContain("type: tasknotesProjects");
    expect(updated).toContain("x-tasknotes-app:");
    expect(updated).toContain("version: 2");
  });

  it("uses the starter view order for first-run navigation", () => {
    expect(defaultNavigationViewKeys([starterDocument()])).toEqual([
      "views/tasknotes-app.base#today",
      "views/tasknotes-app.base#upcoming",
      "views/tasknotes-app.base#calendar",
      "views/tasknotes-app.base#projects",
    ]);
  });

  it("keeps task filters on task views and uses one backlink relationship query for projects", () => {
    const parsed = parse(
      taskNotesDefaultBaseDocument(defaultTaskCollectionConfiguration()),
    ) as {
      filters?: unknown;
      views: Array<{
        name: string;
        filters?: { and?: Array<string | Record<string, unknown>> };
      }>;
    };

    expect(parsed.filters).toBeUndefined();
    expect(
      parsed.views.find(({ name }) => name === "Today")?.filters?.and,
    ).toContain('note["status"].isEmpty() == false');
    const projectFilter = parsed.views
      .find(({ name }) => name === "Projects")
      ?.filters?.and?.join("\n");
    expect(projectFilter).toContain("file.backlinks.filter");
    expect(projectFilter).toContain('value.asFile().properties["projects"]');
    expect(projectFilter).toContain(".length > 0");
  });

  it("keeps provider views when a read-only collection cannot create starter views", async () => {
    const existing = {
      ...starterDocument(),
      id: "work",
      source: {
        ...starterDocument().source,
        path: "views/work.base",
        writable: false,
      },
      views: [
        {
          ...starterDocument().views[0],
          key: "views/work.base#open",
          documentId: "work",
          documentName: "Work",
          id: "open",
          name: "Open work",
          source: {
            ...starterDocument().source,
            path: "views/work.base",
            writable: false,
          },
        },
      ],
    };
    const repository = {
      createViewSource: vi.fn(async () => {
        throw new Error("create_view_source is unavailable");
      }),
      listViews: vi.fn(async () => [existing]),
      syncStatus: vi.fn(),
    } as unknown as TaskRepository;

    await expect(
      ensureTaskNotesDefaultViewSource(
        repository,
        [existing],
        defaultTaskCollectionConfiguration(),
      ),
    ).resolves.toEqual([existing]);
    expect(repository.syncStatus).not.toHaveBeenCalled();
  });
});

function starterDocument(): TaskViewDocument {
  const source = {
    path: "views/tasknotes-app.base",
    format: "obsidian.base",
    revision: "1",
    writable: true,
  };
  return {
    id: "tasknotes-app",
    name: "tasknotes-app",
    source,
    views: ["today", "upcoming", "calendar", "projects"].map((id) => ({
      key: `${source.path}#${id}`,
      documentId: "tasknotes-app",
      documentName: "tasknotes-app",
      id,
      name: `${id[0].toUpperCase()}${id.slice(1)}`,
      properties: [],
      source,
    })),
  };
}
