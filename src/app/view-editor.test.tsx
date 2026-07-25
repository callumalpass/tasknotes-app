import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { parse } from "yaml";
import { afterEach, describe, expect, it, vi } from "vitest";

import { defaultTaskCollectionConfiguration } from "../domain/task-configuration";
import { RepositoryProvider } from "./repository-context";
import { ViewEditor } from "./view-editor";

import type {
  CreateTaskViewSourceInput,
  TaskView,
  TaskViewSourceDocument,
  UpdateTaskViewSourceInput,
} from "../domain/view";
import type { TaskRepository } from "../storage/repository";

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

    const dialog = await screen.findByRole("dialog", { name: "Edit view" });
    expect(dialog).toBeVisible();
    await waitFor(() => expect(dialog).toHaveFocus());
    await screen.findByRole("heading", { name: "View" });
    for (const name of [
      "View",
      "Computed properties",
      "Filter",
      "Arrange",
      "New tasks",
    ])
      expect(screen.getByRole("heading", { name })).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Preview" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Group by" })).toHaveValue(
      "status",
    );
    expect(
      screen.getByRole("combobox", { name: "Sort property 1" }),
    ).toHaveValue("priority");

    fireEvent.click(screen.getByRole("button", { name: "Board" }));
    expect(screen.getByRole("combobox", { name: "Board column" })).toHaveValue(
      "status",
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

    await screen.findByRole("dialog", { name: "Create a view" });
    fireEvent.change(await screen.findByLabelText("Name"), {
      target: { value: "Schedule" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Calendar" }));

    expect(screen.getByRole("heading", { name: "Calendar" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Opens as" })).toBeVisible();
    expect(screen.getByText("Scheduled dates")).toBeVisible();
    expect(screen.getByText("Upcoming recurring instances")).toBeVisible();
    expect(screen.getByText("No computed properties.")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Save view" }));
    await waitFor(() => expect(createViewSource).toHaveBeenCalledOnce());
    expect(createViewSource.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        format: "obsidian.base",
        name: "Schedule",
      }),
    );
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
    await screen.findByRole("dialog", { name: "Edit view" });

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
    await screen.findByRole("dialog", { name: "Edit view" });
    fireEvent.change(await screen.findByLabelText("Name"), {
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
    await screen.findByRole("dialog", { name: "Edit view" });
    fireEvent.change(await screen.findByLabelText("Name"), {
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

    await screen.findByRole("dialog", { name: "Edit view" });
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
    <RepositoryProvider repository={supplied}>
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
    syncStatus: async () => ({
      mode: "live",
      state: "synced",
      pending: 0,
      issues: 0,
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

function baseSource(document: string): TaskViewSourceDocument {
  return {
    path: "views/work.base",
    format: "obsidian.base",
    revision: "one",
    document,
  };
}
