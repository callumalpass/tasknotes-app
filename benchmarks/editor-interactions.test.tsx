import { expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "../src/test/render";
import * as viewPreview from "../src/domain/view-preview";
import { TaskScreen } from "../src/app/task-screen";
import { ViewEditor } from "../src/app/view-editor";
import { RepositoryProvider } from "../src/app/repository-context";
import { TaskSelectionStore } from "../src/app/task-selection-store";
import {
  applyBulkEdits,
  planTaskChange,
} from "../src/application/bulk-task-edit";
import { DemoTaskRepository } from "../src/demo/demo-task-repository";
import { MemoryMutationJournal } from "../src/test/memory-mutation-journal";

it.runIf(process.env.TASKNOTES_BENCH_INTERACTIONS === "1").each([1, 2, 3])(
  "profiles detail, filter editing and bulk selection on 10k tasks (run %i)",
  async (run) => {
    const preview = vi.spyOn(viewPreview, "previewViewDraft");
    const size = 10_000;
    const repository = new DemoTaskRepository(0, undefined, {
      tasks: (model) =>
        Array.from({ length: size }, (_, index) =>
          model.create(
            {
              title: `Task ${index}`,
              status: index % 2 ? "open" : "done",
              tags: [`tag-${index % 4}`],
              contexts: [`context-${index % 4}`],
              projects: [`project-${index % 4}`],
            },
            { id: String(index), now: "2026-11-01T00:00:00Z" },
          ),
        ),
      scratchpads: () => [],
    });
    const tasks = await repository.listSummaries({
      status: "all",
      limit: size,
    });
    expect(tasks.length).toBe(size);
    let visits = 0;
    const order = tasks.map((task) => ({
      get id() {
        visits++;
        return task.id;
      },
    }));
    const id = tasks[size - 1]!.id;
    const samples: Record<string, number> = {};
    let start = performance.now();
    function elapsed(name: string) {
      samples[name] = +(performance.now() - start).toFixed(2);
      start = performance.now();
    }
    const journal = new MemoryMutationJournal();
    const view = render(
      <RepositoryProvider repository={repository} mutationJournal={journal}>
        <TaskScreen
          id={id}
          taskOrder={order}
          onBack={vi.fn()}
          onMaterialized={vi.fn()}
        />
      </RepositoryProvider>,
    );
    const title = await screen.findByLabelText("Task title", { exact: true });
    await screen.findByLabelText("Notes", { exact: true });
    elapsed("detail.openMs");
    visits = 0;
    for (let index = 0; index < 10; index++)
      fireEvent.change(title, { target: { value: `Updated ${index}` } });
    elapsed("detail.tenKeystrokesMs");
    const navigationReads = visits;
    fireEvent.blur(title);
    await waitFor(async () =>
      expect((await repository.get(id))?.title).toBe("Updated 9"),
    );
    elapsed("detail.blurSaveMs");
    start = performance.now();
    view.rerender(
      <RepositoryProvider repository={repository} mutationJournal={journal}>
        <ViewEditor
          initialSection="view-filter"
          onClose={vi.fn()}
          onChanged={async () => {}}
        />
      </RepositoryProvider>,
    );
    const mode = await screen.findByRole("group", {
      name: "Filter editor mode",
    });
    fireEvent.click(within(mode).getByRole("button", { name: "Advanced" }));
    const filter = screen.getByLabelText("Filter expression");
    elapsed("filter.openMs");
    for (const field of ["tags", "contexts", "projects", "status"]) {
      const expr =
        field === "status"
          ? 'note.status == "open"'
          : `note.${field}.contains("${field.slice(0, -1)}-1")`;
      fireEvent.change(filter, { target: { value: expr } });
      await screen.findByText(
        field === "status"
          ? /5,?000 tasks match this draft/
          : /2,?500 tasks match this draft/,
      );
      elapsed(`filter.${field}Ms`);
    }
    const name = screen.getByLabelText("View name");
    preview.mockClear();
    for (let index = 0; index < 5; index++)
      fireEvent.change(name, { target: { value: `Renamed ${index}` } });
    elapsed("filter.renameFiveKeystrokesMs");

    const renamePreviewCalls = preview.mock.calls.length;
    const store = new TaskSelectionStore();
    const owner = {};
    start = performance.now();
    store.register(owner, tasks);
    elapsed("bulk.registerMs");
    for (const task of tasks.slice(0, 32)) {
      store.toggle(task.id);
      void store.selectedTasks;
    }
    elapsed("bulk.select32Ms");
    await act(async () => {
      const { receipts, failures } = await applyBulkEdits(
        store.selectedTasks,
        (task) => planTaskChange(task, { kind: "priority", value: "high" }),
        {
          getSummary: (id) => repository.getSummary(id),
          updateTask: (id, input) => repository.update(id, input),
          setTaskArchived: (id, archived) =>
            repository.setArchived(id, archived),
        },
        "Changed",
      );
      elapsed("bulk.apply32Ms");
      expect(failures).toEqual([]);
      expect(receipts).toHaveLength(32);
    });
    view.unmount();
    console.log(
      JSON.stringify({
        run,
        size,
        navigationReads,
        renamePreviewCalls,
        ...samples,
      }),
    );
  },
  120_000,
);
