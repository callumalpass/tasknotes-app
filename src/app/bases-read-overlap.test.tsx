import { act, fireEvent, render, screen, waitFor } from "../test/render";
import {
  appLocalConnector,
  attachAppLocalFacade,
} from "@mdbase-dev/sdk/app-host";
import type { RepositoryChange } from "../application/ports/task-repository";
import type { Task, UpdateTaskInput } from "../domain/task";
import type { TaskView, TaskViewExecution } from "../domain/view";
import { todayString } from "../domain/task";
import { shiftTaskDate } from "../domain/task-date-actions";
import { taskRepositoryStub } from "../test/task-repository-stub";
import { MemoryMutationJournal } from "../test/memory-mutation-journal";
import { RepositoryProvider } from "./repository-context";
import { useNavigationViews } from "./use-navigation-views";
import { ViewsScreen } from "./views-screen";

afterEach(() => vi.unstubAllGlobals());

// Actual pinned public local facade and MessageChannel, actual navigation/query/
// move components. Native/Core reply bytes and task writes are declared stand-ins;
// this is a transport-overlap regression, not native mutation/custody acceptance.
it("allows a Today move's post-write Bases refresh alongside navigation discovery on the same original facade", async () => {
  // jsdom's ArrayBuffer and Node's MessageChannel must share the same byte
  // realm. Keep the facade's original instanceof checks, not a relaxed shim.
  const transportedBytes = structuredClone(Uint8Array.of(0));
  vi.stubGlobal("Uint8Array", transportedBytes.constructor);
  vi.stubGlobal("ArrayBuffer", transportedBytes.buffer.constructor);
  const channel = new MessageChannel();
  const scope = {
    account: "11111111-1111-4111-8111-111111111111",
    installation: "22222222-2222-4222-8222-222222222222",
    collection: "33333333-3333-4333-8333-333333333333",
    isCurrent: () => true,
  };
  type NativePort = ReturnType<
    Parameters<typeof attachAppLocalFacade>[0]["connect"]
  >;
  const native: NativePort = {
    onframe: null,
    onclose: null,
    send(frame) {
      native.onframe?.(frame);
    },
    close() {
      native.onclose?.();
    },
  };
  const kinds: string[] = [];
  const discover = vi.fn(
    (_native: NativePort, operation: "list-views" | "read-view-source") => {
      kinds.push(operation);
      return Uint8Array.of(8);
    },
  );
  const execute = vi.fn(() => {
    kinds.push("execute");
    return Uint8Array.of(9);
  });
  const attached = attachAppLocalFacade(
    { connect: () => native, discoverBases: discover, executeBases: execute },
    channel.port1,
    scope,
  );
  const connector = appLocalConnector(channel.port2, scope);
  const { port } = await connector.open([0]);
  const readErrors: unknown[] = [];
  let pendingReads = 0;
  const observeRead = <Result,>(pending: Promise<Result>) => {
    pendingReads++;
    return pending
      .catch((error: unknown) => {
        readErrors.push(error);
        throw error;
      })
      .finally(() => {
        pendingReads--;
      });
  };
  let holdDiscovery = false;
  const heldReplies: (() => void)[] = [];
  const post = channel.port1.postMessage.bind(channel.port1);
  const heldPost = vi
    .spyOn(channel.port1, "postMessage")
    .mockImplementation((...args) => {
      const packet: unknown = args[0];
      if (
        holdDiscovery &&
        Array.isArray(packet) &&
        typeof packet[2] === "string" &&
        packet[2].endsWith("response")
      )
        heldReplies.push(() => post(...args));
      else post(...args);
    });
  const view: TaskView = {
    key: "today",
    id: "today",
    name: "Today",
    documentId: "views",
    documentName: "Views",
    properties: [],
    sort: [{ property: "note.tasknotes_manual_order", direction: "desc" }],
    source: {
      path: "views.base",
      format: "obsidian.base",
      revision: "one",
      writable: true,
    },
    presentation: {
      type: "tasknotes.task-list",
      mappings: {},
      options: { sections: "day" },
    },
  };
  const today = todayString();
  const tasks = [
    task("moving", "Move Today task", shiftTaskDate(today, -2)),
    task("target", "Already Today", today),
  ];
  const listeners = new Set<(event?: RepositoryChange) => void>();
  const execution = (): TaskViewExecution => ({
    view,
    rows: tasks.map((value) => ({ task: value, values: {} })),
    totalCount: tasks.length,
    hasMore: false,
    groups: [],
  });
  const document = {
    id: view.documentId,
    name: view.documentName,
    source: view.source,
    views: [view],
  };
  const writes: { id: string; input: UpdateTaskInput }[] = [];
  let writeReturned = false;
  let postWriteRefreshStarted = false;
  const repository = taskRepositoryStub(
    {
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      listSummaries: async () => tasks,
      cachedViews: async () => [],
      listViews: async () => {
        await observeRead(
          port.readAppBasesDiscovery!("list-views", Uint8Array.of(1)),
        );
        return [document];
      },
      cachedViewExecution: async () => null,
      executeView: async () => {
        if (writeReturned) postWriteRefreshStarted = true;
        await observeRead(
          port.readAppBasesDiscovery!("read-view-source", Uint8Array.of(2)),
        );
        await observeRead(port.readAppBases!(Uint8Array.of(3)));
        return execution();
      },
      readViewSource: async () => {
        await observeRead(
          port.readAppBasesDiscovery!("read-view-source", Uint8Array.of(2)),
        );
        return {
          ...view.source,
          document:
            "views:\n  - type: tasknotesTaskList\n    name: Today\n    sort:\n      - column: note.tasknotes_manual_order\n        direction: DESC\n    options: { sections: day }\n",
        };
      },
      updateMany: async (updates) => {
        for (const { id, input } of updates) {
          writes.push({ id, input });
          const value = tasks.find((candidate) => candidate.id === id)!;
          if (input.due !== undefined) value.due = input.due ?? undefined;
          if (input.sortOrder !== undefined)
            value.sortOrder = input.sortOrder ?? undefined;
        }
        // A genuine data notification after local acceptance starts the production
        // navigation READ. Hold its transport response, not an app-side read lock.
        holdDiscovery = true;
        listeners.forEach((listener) => listener({ kind: "data" }));
        await waitFor(() => expect(heldReplies.length).toBe(1));
        writeReturned = true;
        return updates.map(({ id }) =>
          tasks.find((candidate) => candidate.id === id)!,
        );
      },
      collectionInfo: async () => ({
        kind: "connect",
        id: "overlap",
        name: "Tasks",
        location: "Test fixture",
        runtime: "browser",
      }),
    },
    2,
  );
  const journal = new MemoryMutationJournal();
  const app = (navigation: boolean) => (
    <RepositoryProvider
      repository={repository}
      mutationJournal={journal}
      reminderAuthority="none"
    >
      {navigation ? <Navigation /> : null}
      <ViewsScreen
        documents={[document]}
        navigationViewKeys={[view.key]}
        operational
        views={[view]}
        viewKey={view.key}
        onBack={() => {}}
        onOpenTask={() => {}}
        onOpenView={() => {}}
        onSearch={() => {}}
        onMoveNavigationView={() => {}}
        onToggleNavigationView={() => {}}
        onViewsChanged={async () => {}}
      />
    </RepositoryProvider>
  );
  let rendered: ReturnType<typeof render> | undefined;
  try {
    rendered = render(app(false));
    const handle = await screen.findByRole("button", {
      name: "Reorder Move Today task. Drag, or use up and down arrow keys.",
    });
    await waitFor(() => {
      expect(
        discover.mock.calls.filter(
          ([, operation]) => operation === "read-view-source",
        ).length,
      ).toBeGreaterThanOrEqual(2);
      expect(pendingReads).toBe(0);
    });
    rendered.rerender(app(true));
    await waitFor(() => {
      expect(kinds).toContain("list-views");
      expect(pendingReads).toBe(0);
    });
    const target = screen
      .getByText("Already Today")
      .closest<HTMLElement>("[data-manual-order-task]")!;
    Object.defineProperties(handle.closest("[data-manual-order-task]")!, {
      hasPointerCapture: { configurable: true, value: () => true },
      releasePointerCapture: { configurable: true, value: () => {} },
      setPointerCapture: { configurable: true, value: () => {} },
    });
    Object.defineProperty(documentGlobal(), "elementFromPoint", {
      configurable: true,
      value: () => target,
    });
    const press = { button: 0, isPrimary: true, pointerId: 9 };
    fireEvent.pointerDown(handle, press);
    fireEvent.pointerMove(handle, { ...press, clientX: 20, clientY: 20 });
    fireEvent.pointerUp(handle, press);
    await waitFor(() => expect(heldReplies.length).toBe(1));
    await waitFor(() =>
      expect(
        writes.some(({ id, input }) => id === "moving" && input.due === today),
      ).toBe(true),
    );
    // The post-write continuation has attempted its READ while the original
    // background response is still held; no arbitrary sleep or read mutex.
    await waitFor(() => expect(postWriteRefreshStarted).toBe(true));
    holdDiscovery = false;
    await act(async () => {
      heldReplies.splice(0).forEach((release) => release());
    });
    await waitFor(() =>
      expect(
        screen.queryAllByText(
          /Could not move|The view change could not finish/,
        ),
      ).toHaveLength(0),
    );
    await waitFor(() => {
      expect(
        kinds.filter((kind) => kind === "execute").length,
      ).toBeGreaterThanOrEqual(2);
      expect(pendingReads).toBe(0);
    });
    expect(writes.filter(({ id }) => id === "moving")).toHaveLength(1);
    expect(readErrors).toEqual([]);
    expect(screen.getByTestId("navigation-discovery")).toHaveTextContent(
      "ok:1",
    );
  } finally {
    holdDiscovery = false;
    heldReplies.splice(0).forEach((release) => release());
    rendered?.unmount();
    heldPost.mockRestore();
    connector.close();
    attached.close();
    channel.port1.close();
    channel.port2.close();
  }
});
function Navigation() {
  const { discovery, views } = useNavigationViews();
  return (
    <output data-testid="navigation-discovery">
      {discovery}:{views?.length ?? "unknown"}
    </output>
  );
}
function documentGlobal() {
  return globalThis.document;
}
function task(id: string, title: string, due: string): Task {
  return {
    id,
    title,
    due,
    path: `tasks/${id}.md`,
    status: "open",
    completed: false,
    archived: false,
    priority: "normal",
    body: "",
    createdAt: "2026-10-11T00:00:00Z",
    updatedAt: "2026-10-11T00:00:00Z",
    tags: [],
    contexts: [],
    projects: [],
    attachments: [],
    blockedBy: [],
    completeInstances: [],
    skippedInstances: [],
    reminders: [],
    timeEntries: [],
    customProperties: {},
    revision: 1,
    frontmatter: { status: "open" },
  };
}
