import { parseFrontmatter } from "@tasknotes/model/frontmatter";
import { parse } from "yaml";
import { describe, expect, it, vi } from "vitest";

import { defaultTaskCollectionConfiguration } from "./task-configuration";
import {
  defaultNavigationViewKeys,
  taskNotesDefaultBaseDocument,
  taskNotesDefaultBaseSources,
  taskNotesDefaultCanonicalDocument,
  taskNotesViewSourcePath,
} from "./default-view-source";
import { ensureTaskNotesDefaultViewSource } from "../application/ensure-default-view-source";

import type { TaskViewDocument } from "./view";
import type { TaskRepository } from "../application/ports/task-repository";

describe("TaskNotes starter views", () => {
  it("places created Base sources inside the configured TaskNotes folder", () => {
    expect(taskNotesViewSourcePath("Quarterly Review!")).toBe(
      "TaskNotes/Views/quarterly-review.base",
    );
    expect(taskNotesViewSourcePath("Résumé 📌")).toBe(
      "TaskNotes/Views/resume.base",
    );
  });

  it("writes every starter screen as an ordinary editable view", () => {
    const parsed = parse(
      taskNotesDefaultBaseDocument(defaultTaskCollectionConfiguration()),
    ) as {
      formulas?: Record<string, string>;
      views: Array<{
        name: string;
        type: string;
        filters?: { and?: Array<string | Record<string, unknown>> };
        options?: Record<string, unknown>;
        sort?: Array<{ property: string; direction: string }>;
      }>;
    };

    expect(parsed.views.map(({ name, type }) => [name, type])).toEqual([
      ["Today", "tasknotesTaskList"],
      ["Upcoming", "tasknotesCalendar"],
      ["Calendar", "tasknotesCalendar"],
      ["Projects", "tasknotesTaskList"],
      ["Archive", "tasknotesTaskList"],
    ]);
    expect(parsed.views[1].options).toMatchObject({
      calendarView: "listWeek",
      showRecurring: true,
    });
    expect(parsed.views[2].options).toMatchObject({
      calendarView: "dayGridMonth",
      showRecurring: true,
    });
    expect(parsed.formulas).toBeUndefined();
    expect(parsed.views[0].filters?.and?.at(-1)).toEqual({
      or: [
        {
          and: [
            'note["scheduled"].isEmpty() == false',
            'date(note["scheduled"]) <= today()',
          ],
        },
        {
          and: [
            'note["scheduled"].isEmpty()',
            {
              or: ['note["due"].isEmpty()', 'date(note["due"]) <= today()'],
            },
          ],
        },
      ],
    });
    expect(JSON.stringify(parsed)).not.toContain("formula.");
    expect(parsed.views[3].options).toEqual({ create: false });
    expect(parsed.views[4].options).toEqual({ create: false });
    for (const view of parsed.views)
      expect(view.sort?.[0]).toEqual({
        property: "note.tasknotes_manual_order",
        direction: "DESC",
      });
  });

  it("creates each namespaced Base once and returns provider-owned definitions", async () => {
    const created = starterDocuments();
    const createViewSource = vi.fn(async (input: { path: string }) => ({
      path: input.path,
      format: "obsidian.base",
      revision: "1",
      document: "",
    }));
    const repository = {
      createViewSource,
      listViews: vi.fn(async () => created),
      connectionStatus: vi.fn(),
    } as unknown as TaskRepository;

    await expect(
      ensureTaskNotesDefaultViewSource(
        repository,
        [],
        defaultTaskCollectionConfiguration(),
      ),
    ).resolves.toEqual(created);
    expect(createViewSource.mock.calls.map(([input]) => input.path)).toEqual(
      taskNotesDefaultBaseSources(defaultTaskCollectionConfiguration()).map(
        ({ path }) => path,
      ),
    );

    await ensureTaskNotesDefaultViewSource(
      repository,
      created,
      defaultTaskCollectionConfiguration(),
    );
    expect(repository.createViewSource).toHaveBeenCalledTimes(5);
  });

  it("resumes an ambiguous create while preserving an upgraded legacy source", async () => {
    const legacy = legacyStarterDocument();
    const namespaced = starterDocuments();
    const current = [legacy];
    let first = true;
    const createViewSource = vi.fn(async (input: { path: string }) => {
      const created = namespaced.find(
        (document) => document.source.path === input.path,
      );
      if (!created) throw new Error(`Unexpected starter path '${input.path}'.`);
      current.push(created);
      if (first) {
        first = false;
        throw new Error("The response was lost after the authority committed.");
      }
      return {
        path: input.path,
        format: "obsidian.base",
        revision: "1",
        document: "",
      };
    });
    const updateViewSource = vi.fn();
    const deleteViewSource = vi.fn();
    const repository = {
      createViewSource,
      listViews: vi.fn(async () => [...current]),
      updateViewSource,
      deleteViewSource,
    } as unknown as TaskRepository;

    await expect(
      ensureTaskNotesDefaultViewSource(
        repository,
        [legacy],
        defaultTaskCollectionConfiguration(),
      ),
    ).resolves.toHaveLength(6);
    expect(createViewSource).toHaveBeenCalledTimes(5);
    expect(updateViewSource).not.toHaveBeenCalled();
    expect(deleteViewSource).not.toHaveBeenCalled();
  });

  it("keeps canonical filters and sorts projection-free", () => {
    const { frontmatter } = parseFrontmatter(
      taskNotesDefaultCanonicalDocument(defaultTaskCollectionConfiguration()),
    );
    const views = frontmatter.views as Array<{
      id: string;
      where: string;
      order_by?: Array<{ field: string; direction: string }>;
      presentation: { options?: Record<string, unknown> };
    }>;
    const archive = views.find(({ id }) => id === "archive");
    const projects = views.find(({ id }) => id === "projects") as
      | {
          where: string;
          select: string[];
          group_by: Array<{ field: string; direction: string }>;
          presentation: {
            type: string;
            options?: Record<string, unknown>;
          };
        }
      | undefined;
    expect(archive?.where).toContain('file.hasTag("archived") == true');
    expect(archive?.presentation.options).toEqual({ create: false });
    expect(frontmatter.query).toEqual({});
    expect(projects?.where).toContain('note["projects"].isEmpty() == false');
    expect(projects?.select).not.toContain("projects");
    expect(projects?.group_by).toEqual([
      { field: "projects", direction: "asc" },
    ]);
    expect(projects?.presentation).toEqual({
      type: "tasknotes.task-list",
      fallback: "mdbase.table",
      options: { create: false },
    });
    expect(
      views.find(({ id }) => id === "today")?.presentation.options,
    ).toEqual({ sections: "day" });
    const today = views.find(({ id }) => id === "today");
    expect(today?.where).toContain('date(note["scheduled"]) <= today()');
    expect(today?.where).toContain('date(note["due"]) <= today()');
    expect(JSON.stringify(frontmatter)).not.toContain("projection.");
    for (const view of views)
      expect(view.order_by?.[0]).toEqual({
        field: "tasknotes_manual_order",
        direction: "desc",
      });
  });

  it("leaves an existing default source untouched", async () => {
    const existing = starterDocuments();
    const repository = {
      createViewSource: vi.fn(),
      readViewSource: vi.fn(),
      updateViewSource: vi.fn(),
      listViews: vi.fn(),
    } as unknown as TaskRepository;

    await expect(
      ensureTaskNotesDefaultViewSource(
        repository,
        existing,
        defaultTaskCollectionConfiguration(),
      ),
    ).resolves.toEqual(existing);
    expect(repository.createViewSource).not.toHaveBeenCalled();
    expect(repository.readViewSource).not.toHaveBeenCalled();
    expect(repository.updateViewSource).not.toHaveBeenCalled();
    expect(repository.listViews).not.toHaveBeenCalled();
  });

  it("uses the starter view order for first-run navigation", () => {
    expect(defaultNavigationViewKeys(starterDocuments())).toEqual([
      "TaskNotes/Views/today.base#today",
      "TaskNotes/Views/upcoming.base#upcoming",
      "TaskNotes/Views/calendar.base#calendar",
      "TaskNotes/Views/projects.base#projects",
      "TaskNotes/Views/archive.base#archive",
    ]);
  });

  it("keeps legacy navigation available while upgraded sources are created", () => {
    expect(defaultNavigationViewKeys([legacyStarterDocument()])).toEqual([
      "views/tasknotes-app.base#today",
      "views/tasknotes-app.base#upcoming",
      "views/tasknotes-app.base#calendar",
      "views/tasknotes-app.base#projects",
      "views/tasknotes-app.base#archive",
    ]);
  });

  it("expresses Projects as a filtered and grouped task view", () => {
    const parsed = parse(
      taskNotesDefaultBaseDocument(defaultTaskCollectionConfiguration()),
    ) as {
      filters?: unknown;
      views: Array<{
        name: string;
        filters?: { and?: Array<string | Record<string, unknown>> };
        groupBy?: { property: string; direction: string };
        order?: string[];
        options?: Record<string, unknown>;
      }>;
    };

    expect(parsed.filters).toBeUndefined();
    expect(
      parsed.views.find(({ name }) => name === "Today")?.filters?.and,
    ).toContain('note["status"].isEmpty() == false');
    expect(parsed.views.find(({ name }) => name === "Today")?.options).toEqual({
      sections: "day",
    });
    const projectFilter = parsed.views
      .find(({ name }) => name === "Projects")
      ?.filters?.and?.join("\n");
    expect(projectFilter).toContain('note["status"].isEmpty() == false');
    expect(projectFilter).toContain('note["projects"].isEmpty() == false');
    expect(projectFilter).not.toContain("file.backlinks");
    expect(
      parsed.views.find(({ name }) => name === "Projects")?.groupBy,
    ).toEqual({
      property: 'note["projects"]',
      direction: "ASC",
    });
    expect(
      parsed.views.find(({ name }) => name === "Projects")?.order,
    ).not.toContain('note["projects"]');
    expect(
      parsed.views
        .find(({ name }) => name === "Archive")
        ?.filters?.and?.join("\n"),
    ).toContain('file.hasTag("archived") == true');
  });

  it("surfaces a collection that cannot create its required starter views", async () => {
    const starter = starterDocuments()[0];
    const existing = {
      ...starter,
      id: "work",
      source: {
        ...starter.source,
        path: "views/work.base",
        writable: false,
      },
      views: [
        {
          ...starter.views[0],
          key: "views/work.base#open",
          documentId: "work",
          documentName: "Work",
          id: "open",
          name: "Open work",
          source: {
            ...starter.source,
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
      connectionStatus: vi.fn(),
    } as unknown as TaskRepository;

    await expect(
      ensureTaskNotesDefaultViewSource(
        repository,
        [existing],
        defaultTaskCollectionConfiguration(),
      ),
    ).rejects.toThrow("create_view_source is unavailable");
    expect(repository.connectionStatus).not.toHaveBeenCalled();
  });
});

function starterDocuments(): TaskViewDocument[] {
  return ["today", "upcoming", "calendar", "projects", "archive"].map((id) =>
    starterDocument(id),
  );
}

function starterDocument(id: string): TaskViewDocument {
  const source = {
    path: `TaskNotes/Views/${id}.base`,
    format: "obsidian.base",
    revision: "1",
    writable: true,
  };
  return {
    id,
    name: id,
    source,
    views: [
      {
        key: `${source.path}#${id}`,
        documentId: id,
        documentName: id,
        id,
        name: `${id[0].toUpperCase()}${id.slice(1)}`,
        properties: [],
        source,
      },
    ],
  };
}

function legacyStarterDocument(): TaskViewDocument {
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
    views: ["today", "upcoming", "calendar", "projects", "archive"].map(
      (id) => ({
        key: `${source.path}#${id}`,
        documentId: "tasknotes-app",
        documentName: "tasknotes-app",
        id,
        name: `${id[0].toUpperCase()}${id.slice(1)}`,
        properties: [],
        source,
      }),
    ),
  };
}
