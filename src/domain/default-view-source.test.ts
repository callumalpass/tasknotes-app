import { parseFrontmatter } from "@tasknotes/model/frontmatter";
import { parse } from "yaml";
import { describe, expect, it, vi } from "vitest";

import { defaultTaskCollectionConfiguration } from "./task-configuration";
import {
  defaultNavigationViewKeys,
  taskNotesDefaultBaseDocument,
  taskNotesDefaultCanonicalDocument,
} from "./default-view-source";
import { ensureTaskNotesDefaultViewSource } from "../application/ensure-default-view-source";

import type { TaskViewDocument } from "./view";
import type { TaskRepository } from "../application/ports/task-repository";

describe("TaskNotes starter views", () => {
  it("writes every starter screen as an ordinary editable view", () => {
    const parsed = parse(
      taskNotesDefaultBaseDocument(defaultTaskCollectionConfiguration()),
    ) as {
      views: Array<{
        name: string;
        type: string;
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
    expect(parsed.views[3].options).toEqual({ create: false });
    expect(parsed.views[4].options).toEqual({ create: false });
    for (const view of parsed.views)
      expect(view.sort?.[0]).toEqual({
        property: "note.tasknotes_manual_order",
        direction: "DESC",
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

  it("generates canonical projections and ordinary project grouping", () => {
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
    const query = frontmatter.query as {
      projections: Record<string, { expr: string }>;
    };

    expect(archive?.where).toContain('file.hasTag("archived") == true');
    expect(archive?.presentation.options).toEqual({ create: false });
    expect(query.projections.task_date.expr).toContain("scheduled");
    expect(query.projections.task_day.expr).toContain("projection.task_date");
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
    for (const view of views)
      expect(view.order_by?.[0]).toEqual({
        field: "tasknotes_manual_order",
        direction: "desc",
      });
  });

  it("leaves an existing default source untouched", async () => {
    const existing = starterDocument();
    const repository = {
      createViewSource: vi.fn(),
      readViewSource: vi.fn(),
      updateViewSource: vi.fn(),
      listViews: vi.fn(),
    } as unknown as TaskRepository;

    await expect(
      ensureTaskNotesDefaultViewSource(
        repository,
        [existing],
        defaultTaskCollectionConfiguration(),
      ),
    ).resolves.toEqual([existing]);
    expect(repository.createViewSource).not.toHaveBeenCalled();
    expect(repository.readViewSource).not.toHaveBeenCalled();
    expect(repository.updateViewSource).not.toHaveBeenCalled();
    expect(repository.listViews).not.toHaveBeenCalled();
  });

  it("uses the starter view order for first-run navigation", () => {
    expect(defaultNavigationViewKeys([starterDocument()])).toEqual([
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
