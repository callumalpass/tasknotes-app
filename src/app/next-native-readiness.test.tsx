import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "../test/render";
import type { ChangesWatch, ChangesWatchState } from "@mdbase-dev/sdk";
import type {
  AppBasesDescriptor,
  AppBasesResult,
} from "@mdbase-dev/sdk/app-host";
import { nextTaskFixture } from "../test/next-task-fixture";
import { MemoryMutationJournal } from "../test/memory-mutation-journal";
import { NextTaskRepository } from "../storage/next-repository";
import { RepositoryProvider } from "./repository-context";
import { CollectionGateContext } from "./collection-context";
import { AppShell } from "./app-shell";
import { taskNotesViewSourcePath } from "../domain/default-view-source";

// Real SDK task READs/CRUD and actual app shell; catalog and Bases replies are
// declared stand-ins. No native/LAB/authority qualification.
const closes: (() => void)[] = [];
beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  vi.clearAllMocks();
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: () => false,
  }));
});
afterEach(() => {
  closes.splice(0).forEach((close) => close());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function fixture() {
  const f = await nextTaskFixture();
  closes.push(f.close);
  return f;
}

function renderShell(repository: NextTaskRepository) {
  return render(
    <CollectionGateContext.Provider
      value={{
        collectionUi: null,
        changeCollection: vi.fn(),
        reauthorizeCurrentCollection: vi.fn(),
      }}
    >
      <RepositoryProvider
        repository={repository}
        mutationJournal={new MemoryMutationJournal()}
        reminderAuthority="none"
      >
        <AppShell />
      </RepositoryProvider>
    </CollectionGateContext.Provider>,
  );
}

it("shows a visible discovery refusal with Retry instead of an empty catalog or a silent Scratchpad fallback", async () => {
  const f = await fixture();
  const discovery = vi.spyOn(f.client, "listAppBasesViews").mockResolvedValue({
    kind: "refusal",
    problem: {
      code: "forbidden",
      reason: "insufficient_access",
      recovery: "reauthorize",
      message: "Private record contents must not appear in the shell or logs",
    },
  });
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const create = vi.spyOn(f.repository, "createViewSource");
  renderShell(f.repository);
  expect(await screen.findByText("Couldn't load your views.")).toBeVisible();
  expect(screen.queryByText("No views yet.")).not.toBeInTheDocument();
  expect(screen.queryByText(/Private record contents/)).not.toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Scratchpad" }),
  ).not.toBeInTheDocument();
  expect(create).not.toHaveBeenCalled();
  expect(log).toHaveBeenCalledOnce();
  expect(log.mock.calls[0]?.[0]).toBe("[TaskNotes view discovery]");
  expect(JSON.parse(String(log.mock.calls[0]?.[1]))).toMatchObject({
    outcome: "error",
    viewCount: null,
    code: "forbidden",
    reason: "insufficient_access",
  });
  discovery.mockResolvedValue({
    kind: "success",
    views: [],
    continuation: null,
    clock: { instant: 1, tz: "UTC", localDate: "1970-01-01" },
    collectionRevision: "sha256:" + "ab".repeat(32),
  });
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("No views yet.")).toBeVisible();
  expect(
    screen.queryByText("Couldn't load your views."),
  ).not.toBeInTheDocument();
  expect(log).toHaveBeenCalledTimes(2);
  expect(JSON.parse(String(log.mock.calls[1]?.[1]))).toMatchObject({
    outcome: "empty",
    viewCount: 0,
    code: null,
    reason: null,
  });
  expect(create).not.toHaveBeenCalled();
});

it.each(["active", "starting"] as const)(
  "recovers failed views when sync restores before a %s local watch",
  async (watchState) => {
    const f = await fixture();
    f.replica.seed({
      path: "TaskNotes/Scratchpad/existing.md",
      types: ["tasknotes-scratch"],
      frontmatter: {
        type: "tasknotes-scratch",
        id: crypto.randomUUID(),
        state: "active",
        dateCreated: "2026-10-14T00:00:00Z",
        dateModified: "2026-10-14T00:00:00Z",
      },
      body: "Existing note",
    });
    let notify: Parameters<ChangesWatch["subscribe"]>[0] | undefined;
    const watch = Object.assign(vi.fn(), {
      state: "active" as ChangesWatchState,
      error: null,
      ready: Promise.resolve(),
      subscribe(listener: Parameters<ChangesWatch["subscribe"]>[0]) {
        notify = listener;
        listener(watch.state, null);
        return () => {
          notify = undefined;
        };
      },
    });
    // Declared watch ordering stand-in; SDK status pushes and READs remain real.
    vi.spyOn(f.client, "watchChanges").mockReturnValue(watch);
    f.replica.setOnline(false);
    await waitFor(() => expect(f.client.status?.connection).toBe("offline"));
    const discovery = vi
      .spyOn(f.client, "listAppBasesViews")
      .mockImplementation(async () =>
        f.client.status?.connection === "offline"
          ? {
              kind: "refusal",
              problem: {
                code: "unavailable",
                recovery: "retry",
                message: "Offline discovery",
              },
            }
          : {
              kind: "success",
              views: [],
              continuation: null,
              clock: { instant: 1, tz: "UTC", localDate: "1970-01-01" },
              collectionRevision: "sha256:" + "ab".repeat(32),
            },
      );
    const submit = vi.spyOn(f.client, "submit");
    renderShell(f.repository);
    expect(
      await screen.findByText("Couldn\u0027t load your views."),
    ).toBeVisible();
    const before = discovery.mock.calls.length;
    act(() => {
      watch.state = watchState;
      notify?.(watchState, null);
    });
    act(() => f.replica.setOnline(true));
    await waitFor(() => expect(f.client.status?.connection).toBe("online"));
    if (watchState === "starting")
      act(() => {
        watch.state = "active";
        notify?.("active", null);
      });
    expect(await screen.findByText("No views yet.")).toBeVisible();
    expect(discovery.mock.calls.length).toBeGreaterThan(before);
    expect(
      screen.queryByText("Couldn\u0027t load your views."),
    ).not.toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  },
);

it("preserves cached navigation and original preferences when a discovery READ fails", async () => {
  const f = await fixture();
  const source = {
    path: taskNotesViewSourcePath("today"),
    revision: "cached-revision",
    format: "obsidian.base",
    writable: true,
  };
  const key = "original-view#0";
  vi.spyOn(f.repository, "cachedViews").mockResolvedValue([
    {
      id: "original-view",
      name: "Today",
      source,
      views: [
        {
          key,
          documentId: "original-view",
          documentName: "Today",
          id: "0",
          name: "Today",
          properties: [],
          source,
        },
      ],
    },
  ]);
  const info = await f.repository.collectionInfo();
  const preferences = JSON.stringify({
    [`${info.kind}:${info.id}`]: [key, "uncached-original-view#1"],
  });
  localStorage.setItem("tasknotes:navigation-views:v4", preferences);
  vi.spyOn(f.client, "listAppBasesViews").mockResolvedValue({
    kind: "refusal",
    problem: {
      code: "unavailable",
      recovery: "retry",
      message: "Original discovery unavailable",
    },
  });
  renderShell(f.repository);
  expect(await screen.findByText("Couldn't load your views.")).toBeVisible();
  expect(
    within(screen.getByRole("complementary", { name: "Primary" })).getByRole(
      "button",
      { name: /^Today/ },
    ),
  ).toBeVisible();
  expect(localStorage.getItem("tasknotes:navigation-views:v4")).toBe(
    preferences,
  );
  expect(screen.queryByText("No views yet.")).not.toBeInTheDocument();
});

it.each([
  {
    changes: 6,
    label: "continuous post-sign-in changes during the initial READ",
  },
])(
  "opens $label into the existing Today navigation and task rows, without setup or new writes",
  async ({ changes }) => {
    const f = await fixture();
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const originalWatch = f.client.watchChanges.bind(f.client);
    let onChanges: Parameters<typeof f.client.watchChanges>[0] | undefined;
    vi.spyOn(f.client, "watchChanges").mockImplementation(
      (listener, options) => {
        onChanges = listener;
        return originalWatch(listener, options);
      },
    );
    const seed = await f.repository.create({ title: "Existing Today task" });
    f.replica.confirmAll();
    await vi.waitFor(async () =>
      expect(await f.client.pendingWrites()).toEqual([]),
    );
    const record = (await f.client.query({ types: ["task"] })).records.find(
      (candidate) => candidate.path === seed.path,
    )!;
    const revision = "sha256:" + "ab".repeat(32);
    const clock = { instant: 1, tz: "UTC", localDate: "1970-01-01" };
    const view: AppBasesDescriptor = {
      record: "00000000-0000-4000-8000-000000000001",
      path: taskNotesViewSourcePath("today"),
      sourceRevision: revision,
      ordinal: 0,
      name: "Today",
      viewType: "tasknotesTaskList",
      implementations: [],
    };
    let remainingChanges = changes;
    const discovery = vi
      .spyOn(f.client, "listAppBasesViews")
      .mockImplementation(async () => {
        // Declared change-feed stand-in through the original public watch callback.
        // Each completed READ is retired until catch-up reaches a quiet window.
        if (remainingChanges-- > 0)
          onChanges?.({
            changes: [],
            cursor: `synthetic-change-${remainingChanges}`,
            reset: true,
          });
        return {
          kind: "success",
          views: [view],
          clock,
          collectionRevision: revision,
          continuation: null,
        };
      });
    vi.spyOn(f.client, "readAppBasesViewSource").mockResolvedValue({
      kind: "success",
      view,
      clock,
      collectionRevision: revision,
      source: "views:\n  - name: Today\n    type: tasknotesTaskList\n",
    });
    const result: Extract<AppBasesResult, { kind: "success" }> = {
      kind: "success",
      view,
      columns: ["note.title"],
      unavailableColumns: [],
      rows: [
        {
          record: record.id,
          path: record.path,
          sourceRevision: record.revision,
          cells: [{ kind: "text", value: "Existing Today task" }],
        },
      ],
      groups: [],
      clock,
      collectionRevision: revision,
    };
    vi.spyOn(f.client, "executeAppBases").mockResolvedValue(result);
    const create = vi.spyOn(f.client, "create");
    const mounted = render(
      <CollectionGateContext.Provider
        value={{
          collectionUi: null,
          changeCollection: vi.fn(),
          reauthorizeCurrentCollection: vi.fn(),
        }}
      >
        <RepositoryProvider
          repository={f.repository}
          mutationJournal={new MemoryMutationJournal()}
          reminderAuthority="none"
        >
          <AppShell />
        </RepositoryProvider>
      </CollectionGateContext.Provider>,
    );
    const navigation = await screen.findByRole("complementary", {
      name: "Primary",
    });
    expect(
      await within(navigation).findByRole("button", { name: /^Today/ }),
    ).toBeVisible();
    expect(await screen.findByRole("heading", { name: "Today" })).toBeVisible();
    expect(await screen.findByText("Existing Today task")).toBeVisible();
    expect(discovery.mock.calls.length).toBeGreaterThanOrEqual(changes + 1);
    expect(
      screen.queryByText("Couldn't load your views."),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("No views yet.")).not.toBeInTheDocument();
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.parse(String(log.mock.calls[0]?.[1]))).toMatchObject({
      outcome: "ok",
      viewCount: 1,
      published: true,
      code: null,
      reason: null,
    });
    expect(create).not.toHaveBeenCalled();
    const initialReads = discovery.mock.calls.length;
    await act(async () => {
      for (let i = 0; i < 50; i++)
        onChanges?.({
          changes: [],
          cursor: `synthetic-burst-${i}`,
          reset: true,
        });
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    await waitFor(() =>
      expect(discovery.mock.calls.length).toBeGreaterThan(initialReads),
    );
    expect(discovery.mock.calls.length).toBeLessThanOrEqual(initialReads + 2);
    expect(screen.getByRole("heading", { name: "Today" })).toBeVisible();
    expect(
      screen.queryByText("Couldn't load your views."),
    ).not.toBeInTheDocument();
    mounted.unmount();
  },
);
