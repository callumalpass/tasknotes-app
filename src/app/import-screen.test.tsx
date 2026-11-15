import { StrictMode } from "react";
import { Capacitor } from "@capacitor/core";
import { fireEvent, render, screen, waitFor } from "../test/render";
import { exampleSource, exampleTarget } from "../../apps/import/src/example";
import type {
  ImportReport,
  TaskRepository,
} from "tasknotes-import/task-repository";
import {
  CollectionGateContext,
  type CollectionGateContextValue,
} from "./collection-context";
import { ImportScreen } from "./import-screen";
import { deferred } from "../test/deferred";

const fixture = vi.hoisted(() => ({ source: vi.fn(), connect: vi.fn() }));
vi.mock("../cloud/todoist-return", () => ({
  todoistReturn: fixture.source,
  clearTodoistReturn: vi.fn(),
}));
vi.mock("../cloud/todoist-authorization", () => ({
  connectTodoist: fixture.connect,
}));

let repository: TaskRepository;
let actions: CollectionGateContextValue;
beforeEach(() => {
  fixture.source.mockResolvedValue({
    source: { ...exampleSource, tasks: exampleSource.tasks.slice(0, 1) },
  });
  repository = {
    isCurrent: vi.fn(() => true),
    discoverTypes: vi.fn(async () => [structuredClone(exampleTarget)]),
    importTasks: vi.fn<TaskRepository["importTasks"]>(async (plan, publish) => {
      const report: ImportReport[] = plan.map((task) => ({
        sourceId: task.sourceId,
        path: task.path,
        status: "created",
        mutationId: "original",
      }));
      publish(report);
      return report;
    }),
    recoverWrites: vi.fn(async () => undefined),
  };
  actions = {
    collectionUi: null,
    changeCollection: vi.fn(),
    reauthorizeCurrentCollection: vi.fn(),
    importDestination: {
      id: "selected-collection",
      name: "Selected collection",
      repository: async () => repository,
    },
  };
});

function open() {
  return render(
    <StrictMode>
      <CollectionGateContext.Provider value={actions}>
        <ImportScreen />
      </CollectionGateContext.Provider>
    </StrictMode>,
  );
}

async function preview() {
  await screen.findByText("Write the project brief");
  await waitFor(() =>
    expect(screen.getByLabelText("Task type")).toHaveValue("task"),
  );
  fireEvent.change(screen.getByLabelText("Todoist API priority 1"), {
    target: { value: "high" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Preview import" }));
  await screen.findByRole("region", { name: "Review import" });
}

it("uses the selected app collection and requires a reviewed preview before creating", async () => {
  open();
  expect(screen.getByText("Destination: Selected collection")).toBeVisible();
  await preview();
  expect(repository.importTasks).not.toHaveBeenCalled();
  const create = screen.getByRole("button", { name: "Import selected tasks" });
  expect(create).toBeDisabled();
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "I reviewed these tasks and the destination.",
    }),
  );
  fireEvent.click(create);
  await waitFor(() => expect(repository.importTasks).toHaveBeenCalledTimes(1));
  expect(repository.discoverTypes).toHaveBeenCalled();
  expect(
    await screen.findByRole("region", { name: "Import report" }),
  ).toHaveTextContent("Created");
  expect(fixture.connect).not.toHaveBeenCalled();
  expect(actions.changeCollection).not.toHaveBeenCalled();
});

it("blocks writes if the destination definition changed after preview", async () => {
  open();
  await preview();
  vi.mocked(repository.discoverTypes).mockResolvedValue([
    { ...exampleTarget, revision: "changed" },
  ]);
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "I reviewed these tasks and the destination.",
    }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Import selected tasks" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Destination changed",
  );
  expect(repository.importTasks).not.toHaveBeenCalled();
});

it("invalidates preview and consent when mappings change", async () => {
  open();
  await preview();
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "I reviewed these tasks and the destination.",
    }),
  );
  fireEvent.change(screen.getByLabelText("Import folder"), {
    target: { value: "elsewhere" },
  });
  expect(
    screen.queryByRole("region", { name: "Review import" }),
  ).not.toBeInTheDocument();
  expect(repository.importTasks).not.toHaveBeenCalled();
});

it("recovers only the uncertain import's original mutation without resubmitting", async () => {
  vi.mocked(repository.importTasks).mockImplementation(
    async (plan, publish) => {
      const report: ImportReport[] = [
        {
          sourceId: plan[0].sourceId,
          path: plan[0].path,
          status: "uncertain",
          mutationId: "original",
        },
      ];
      publish(report);
      return report;
    },
  );
  open();
  await preview();
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "I reviewed these tasks and the destination.",
    }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Import selected tasks" }),
  );
  const recover = await screen.findByRole("button", {
    name: "Recover original writes",
  });
  await waitFor(() => expect(recover).toBeEnabled());
  fireEvent.click(recover);
  await waitFor(() =>
    expect(repository.recoverWrites).toHaveBeenCalledWith(
      ["original"],
      expect.any(Array),
      expect.any(Array),
      expect.any(Function),
    ),
  );
  expect(repository.importTasks).toHaveBeenCalledTimes(1);
});

it("signals cancellation on unmount without abandoning the captured write", async () => {
  const pending = deferred<ImportReport[]>();
  let signal: AbortSignal | undefined;
  vi.mocked(repository.importTasks).mockImplementation(
    (_plan, _publish, currentSignal) => {
      signal = currentSignal;
      return pending.promise;
    },
  );
  const view = open();
  await preview();
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "I reviewed these tasks and the destination.",
    }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Import selected tasks" }),
  );
  await waitFor(() => expect(signal).toBeDefined());
  expect(signal?.aborted).toBe(false);
  view.unmount();
  expect(signal?.aborted).toBe(true);
  pending.resolve([]);
});

it("cannot preview or create without the app's selected destination", async () => {
  delete actions.importDestination;
  open();
  await screen.findByText("Write the project brief");
  expect(screen.getByRole("button", { name: "Preview import" })).toBeDisabled();
  expect(repository.discoverTypes).not.toHaveBeenCalled();
});

it("offers web import on native without starting native OAuth or opening a destination", async () => {
  vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  open();
  expect(
    screen.getByRole("link", { name: "Import from Todoist in the web app." }),
  ).toHaveAttribute("href", "https://app.tasknotes.dev/import");
  expect(
    screen.queryByRole("button", { name: "Connect Todoist" }),
  ).not.toBeInTheDocument();
  await waitFor(() => expect(fixture.source).toHaveBeenCalled());
  expect(repository.discoverTypes).not.toHaveBeenCalled();
  expect(fixture.connect).not.toHaveBeenCalled();
});
