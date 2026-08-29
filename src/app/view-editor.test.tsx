import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { parse } from "yaml";
import { afterEach, describe, expect, it, vi } from "vitest";

import { defaultTaskCollectionConfiguration } from "../domain/task-configuration";
import { suggestedFilterAndSortFields } from "../domain/view-document";
import { RepositoryProvider } from "./repository-context";
import { ViewEditor } from "./view-editor";

import type {
  CreateTaskViewSourceInput,
  TaskView,
  TaskViewSourceDocument,
  UpdateTaskViewSourceInput,
} from "../domain/view";
import type { TaskRepository } from "../application/ports/task-repository";
import { MemoryMutationJournal } from "../test/memory-mutation-journal";

describe("ViewEditor", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses one complete editor for an existing view and saves organization changes", async () => {
    const source = baseSource(`views:
  - type: tasknotesTaskList
    name: Work
    order: [status, due]
    sort:
      - { property: priority, direction: DESC }
    groupBy: { property: status, direction: ASC }
`);
    const updateViewSource = vi.fn(
      async (input: UpdateTaskViewSourceInput) => ({
        ...source,
        document: input.document,
      }),
    );
    const onChanged = vi.fn(async () => undefined);
    renderEditor({
      repository: repository({ source, updateViewSource }),
      view: savedView(),
      onChanged,
    });

    const dialog = await screen.findByRole("dialog", { name: "Work" });
    expect(dialog).toBeVisible();
    await waitFor(() => expect(dialog).toHaveFocus());
    await screen.findByRole("heading", { name: "View details" });
    for (const name of [
      "View details",
      "Advanced",
      "Filter",
      "Group & sort",
      "Fields shown",
      "New tasks",
    ])
      expect(screen.getByRole("heading", { name })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Preview" })).toBeVisible();
    fireEvent.click(screen.getByRole("heading", { name: "Group & sort" }));
    expect(screen.getByRole("combobox", { name: "Group by" })).toHaveValue(
      "Status",
    );
    expect(
      screen.getByRole("combobox", { name: "Sort property 1" }),
    ).toHaveValue("Priority");

    fireEvent.click(screen.getByRole("radio", { name: "Board" }));
    expect(screen.getByRole("combobox", { name: "Board column" })).toHaveValue(
      "Status",
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: "Sort property 1" }),
      {
        target: { value: "due" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));

    await waitFor(() => expect(updateViewSource).toHaveBeenCalledOnce());
    const document = updateViewSource.mock.calls[0][0].document;
    const parsed = parse(document) as {
      views: Array<Record<string, unknown>>;
    };
    expect(parsed.views[0].type).toBe("tasknotesKanban");
    expect(parsed.views[0].sort).toEqual([
      { property: "due", direction: "DESC" },
    ]);
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("shows calendar settings in the same editor when creating a view", async () => {
    const createViewSource = vi.fn(
      async (input: CreateTaskViewSourceInput) => ({
        path: "views/schedule.base",
        format: "obsidian.base",
        revision: "two",
        document: input.document,
      }),
    );
    renderEditor({
      repository: repository({ createViewSource }),
    });

    await screen.findByRole("dialog", { name: "New view" });
    fireEvent.change(await screen.findByLabelText("View name"), {
      target: { value: "Schedule" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "Calendar" }));

    expect(screen.getByRole("heading", { name: "Calendar" })).toBeVisible();
    fireEvent.click(screen.getByRole("heading", { name: "Calendar" }));
    expect(screen.getByRole("combobox", { name: "Opens as" })).toBeVisible();
    expect(screen.getByText("Scheduled dates")).toBeVisible();
    expect(screen.getByText("Upcoming recurring instances")).toBeVisible();
    fireEvent.click(screen.getByRole("heading", { name: "Advanced" }));
    expect(screen.getByText("No computed properties.")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Save view" }));
    await waitFor(() => expect(createViewSource).toHaveBeenCalledOnce());
    expect(createViewSource.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        format: "obsidian.base",
        name: "Schedule",
        path: "TaskNotes/Views/schedule.base",
      }),
    );
  });

  it("offers Manual order as a first-class descending sort", async () => {
    const createViewSource = vi.fn(
      async (input: CreateTaskViewSourceInput) => ({
        path: "views/manual.base",
        format: "obsidian.base",
        revision: "two",
        document: input.document,
      }),
    );
    renderEditor({ repository: repository({ createViewSource }) });

    await screen.findByRole("dialog", { name: "New view" });
    fireEvent.change(screen.getByLabelText("View name"), {
      target: { value: "Manual" },
    });
    fireEvent.click(screen.getByRole("heading", { name: "Group & sort" }));
    const property = screen.getByRole("combobox", {
      name: "Property to sort",
    });
    fireEvent.change(property, {
      target: { value: "tasknotes_manual_order" },
    });
    fireEvent.click(
      within(property.closest(".add-view-property")!).getByRole("button", {
        name: "Add",
      }),
    );

    expect(
      screen.getByText(
        "Manual order is active. Drag handles will appear on tasks.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("combobox", { name: "Sort property 1" }),
    ).toHaveValue("Manual order");
    expect(
      screen.getByRole("combobox", { name: "Sort direction 1" }),
    ).toHaveAttribute("data-value", "desc");

    fireEvent.click(screen.getByRole("button", { name: "Save view" }));
    await waitFor(() => expect(createViewSource).toHaveBeenCalledOnce());
    const parsed = parse(createViewSource.mock.calls[0][0].document) as {
      views: Array<{ sort: unknown }>;
    };
    expect(parsed.views[0].sort).toEqual([
      {
        property: "tasknotes_manual_order",
        direction: "DESC",
      },
    ]);
  });

  it("guards unsaved changes but closes an untouched existing view directly", async () => {
    const onClose = vi.fn();
    const source = baseSource(
      "views: [{ type: tasknotesTaskList, name: Work }]\n",
    );
    const { unmount } = renderEditor({
      repository: repository({ source }),
      view: savedView(),
      onClose,
    });
    await screen.findByRole("dialog", { name: "Work" });

    fireEvent.click(
      screen.getAllByRole("button", { name: "Close view editor" }).at(-1)!,
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledOnce();

    unmount();
    onClose.mockClear();
    renderEditor({
      repository: repository({ source }),
      view: savedView(),
      onClose,
    });
    await screen.findByRole("dialog", { name: "Work" });
    fireEvent.change(await screen.findByLabelText("View name"), {
      target: { value: "Changed" },
    });
    fireEvent.click(
      screen.getAllByRole("button", { name: "Close view editor" }).at(-1)!,
    );
    expect(
      screen.getByRole("alertdialog", { name: "Discard changes?" }),
    ).toBeVisible();
    expect(
      screen.getByText("Your changes to this view have not been saved."),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("keeps the active field focused while editing an existing view", async () => {
    renderEditor({ repository: repository(), view: savedView() });

    await screen.findByRole("dialog", { name: "Work" });
    const name = await screen.findByLabelText("View name");
    name.focus();
    fireEvent.change(name, { target: { value: "W" } });

    expect(name).toHaveFocus();
    fireEvent.change(name, { target: { value: "Work" } });
    expect(name).toHaveFocus();
    expect(name).toHaveValue("Work");
  });

  it("closes after the write without waiting for catalogue reconciliation", async () => {
    const source = baseSource(
      "views: [{ type: tasknotesTaskList, name: Work }]\n",
    );
    const updateViewSource = vi.fn(
      async (input: UpdateTaskViewSourceInput) => ({
        ...source,
        revision: "two",
        document: input.document,
      }),
    );
    const onClose = vi.fn();
    let finishRefresh!: () => void;
    const refresh = new Promise<void>((resolve) => {
      finishRefresh = resolve;
    });
    const onChanged = vi.fn(() => refresh);
    renderEditor({
      repository: repository({ source, updateViewSource }),
      view: savedView(),
      onClose,
      onChanged,
    });
    await screen.findByRole("dialog", { name: "Work" });
    fireEvent.change(await screen.findByLabelText("View name"), {
      target: { value: "Saved work" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));

    await waitFor(() => expect(updateViewSource).toHaveBeenCalledOnce());
    expect(onChanged).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
    finishRefresh();
  });

  it("creates and edits formulas that become available to the view", async () => {
    const source = baseSource(`formulas:
  score: 'if(priority == "high", 2, 1)'
views:
  - type: tasknotesTaskList
    name: Work
    order: [title, formula.score]
`);
    const updateViewSource = vi.fn(
      async (input: UpdateTaskViewSourceInput) => ({
        ...source,
        document: input.document,
      }),
    );
    renderEditor({
      repository: repository({ source, updateViewSource }),
      view: savedView(),
    });

    await screen.findByRole("dialog", { name: "Work" });
    fireEvent.click(screen.getByRole("heading", { name: "Advanced" }));
    expect(screen.getByLabelText("Computed property name 1")).toHaveValue(
      "score",
    );
    expect(screen.getAllByText("formula.score").length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("Computed property expression 1"), {
      target: { value: 'if(priority == "high", 3, 1)' },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add formula" }));
    fireEvent.change(screen.getByLabelText("Computed property name 2"), {
      target: { value: "label" },
    });
    fireEvent.change(screen.getByLabelText("Computed property expression 2"), {
      target: { value: 'if(formula.score > 1, "urgent", "normal")' },
    });
    await screen.findByText("Computed properties are valid");
    const save = screen.getByRole("button", { name: "Save view" });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);

    await waitFor(() => expect(updateViewSource).toHaveBeenCalledOnce());
    expect(
      (
        parse(updateViewSource.mock.calls[0][0].document) as Record<
          string,
          unknown
        >
      ).formulas,
    ).toEqual({
      score: 'if(priority == "high", 3, 1)',
      label: 'if(formula.score > 1, "urgent", "normal")',
    });
  });

  it("does not suggest canonical projections for filters or sorts", async () => {
    const source = canonicalSource(`---
type: view
id: ranked
version: 1
name: Ranked
query:
  projections:
    score: { expr: 'priority == "high" ? 2 : 1' }
views:
  - id: ranked
    name: Ranked
    select: [title, projection.score]
    presentation: { type: tasknotes.task-list }
---
`);
    renderEditor({
      repository: repository({ source }),
      view: canonicalSavedView(),
    });

    expect(
      suggestedFilterAndSortFields("mdbase-cel", [
        { key: "priority", label: "Priority" },
        { key: "projection.score", label: "Score" },
        { key: 'projection["display score"]', label: "Display score" },
      ]).map(({ key }) => key),
    ).toEqual(["priority"]);

    await screen.findByRole("dialog", { name: "Ranked" });
    fireEvent.click(screen.getByRole("heading", { name: "Group & sort" }));
    const sortProperty = screen.getByRole("combobox", {
      name: "Property to sort",
    });
    fireEvent.focus(sortProperty);
    expect(
      within(
        screen.getByRole("listbox", {
          name: "Property to sort suggestions",
        }),
      ).queryByRole("option", { name: /projection\.score/ }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("heading", { name: "Fields shown" }));
    const displayedProperty = screen.getByRole("combobox", {
      name: "Property to display",
    });
    fireEvent.focus(displayedProperty);
    expect(
      within(
        screen.getByRole("listbox", {
          name: "Property to display suggestions",
        }),
      ).getByRole("option", { name: /projection\.score/ }),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("heading", { name: "Advanced" }));
    expect(
      screen.getByText("Reusable values for grouping and displayed fields."),
    ).toBeVisible();
  });

  it("keeps only one editing section open at a time", async () => {
    renderEditor({ repository: repository(), view: savedView() });
    await screen.findByRole("dialog", { name: "Work" });

    fireEvent.click(screen.getByRole("heading", { name: "Group & sort" }));
    expect(screen.getByRole("combobox", { name: "Group by" })).toBeVisible();

    fireEvent.click(screen.getByRole("heading", { name: "Fields shown" }));
    expect(
      screen.queryByRole("combobox", { name: "Group by" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Property to display" }),
    ).toBeVisible();
  });

  it("explains that deleting a view leaves tasks alone", async () => {
    renderEditor({ repository: repository(), view: savedView() });
    await screen.findByRole("dialog", { name: "Work" });

    fireEvent.click(screen.getByRole("button", { name: "Delete view" }));

    expect(
      screen.getByRole("alertdialog", { name: "Delete “Work”?" }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "This removes the saved view only. Your tasks won’t be deleted.",
      ),
    ).toBeVisible();
  });
});

function renderEditor({
  repository: supplied,
  view,
  onClose = vi.fn(),
  onChanged = vi.fn(async () => undefined),
}: {
  repository: TaskRepository;
  view?: TaskView;
  onClose?: () => void;
  onChanged?: () => Promise<void>;
}) {
  return render(
    <RepositoryProvider
      mutationJournal={new MemoryMutationJournal()}
      repository={supplied}
    >
      <ViewEditor view={view} onClose={onClose} onChanged={onChanged} />
    </RepositoryProvider>,
  );
}

function repository(
  overrides: Partial<TaskRepository> & { source?: TaskViewSourceDocument } = {},
): TaskRepository {
  const source =
    overrides.source ??
    baseSource("views: [{ type: tasknotesTaskList, name: Work }]\n");
  return {
    initialize: async () => undefined,
    refresh: async () => ({
      scanned: 0,
      changed: 0,
      removed: 0,
      elapsedMs: 0,
    }),
    list: async () => [],
    completeField: async () => [],
    readViewSource: async () => source,
    taskConfiguration: async () => defaultTaskCollectionConfiguration(),
    connectionStatus: async () => ({
      state: "connected",
    }),
    syncIssues: async () => [],
    ...overrides,
  } as TaskRepository;
}

function savedView(): TaskView {
  return {
    key: "views/work.base#work",
    documentId: "work",
    documentName: "Work",
    id: "work",
    name: "Work",
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

function canonicalSavedView(): TaskView {
  return {
    ...savedView(),
    key: "views/ranked.md#ranked",
    documentId: "ranked",
    documentName: "Ranked",
    id: "ranked",
    name: "Ranked",
    properties: [{ key: "title" }, { key: "projection.score" }],
    source: {
      path: "views/ranked.md",
      format: "mdbase.view",
      revision: "one",
      writable: true,
    },
  };
}

function canonicalSource(document: string): TaskViewSourceDocument {
  return {
    path: "views/ranked.md",
    format: "mdbase.view",
    revision: "one",
    document,
  };
}

function baseSource(document: string): TaskViewSourceDocument {
  return {
    path: "views/work.base",
    format: "obsidian.base",
    revision: "one",
    document,
  };
}
