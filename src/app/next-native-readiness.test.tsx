import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type {
  AppBasesDescriptor,
  AppBasesResult,
} from "@mdbase-dev/sdk/app-host";
import type {
  ModelSetupJournal,
  ModelSetupView,
} from "../application/ports/model-setup";
import { nextTaskFixture } from "../test/next-task-fixture";
import { MemoryMutationJournal } from "../test/memory-mutation-journal";
import { NextTaskRepository } from "../storage/next-repository";
import { RepositoryProvider } from "./repository-context";
import { CollectionGateContext } from "./collection-context";
import { AppShell } from "./app-shell";
import { taskNotesViewSourcePath } from "../domain/default-view-source";

// Real SDK task READs/CRUD and actual app shell; catalog, Bases and semantic
// setup replies are declared stand-ins. No native/LAB/authority qualification.
const m = vi.hoisted(() => ({
  inspect: vi.fn<() => Promise<ModelSetupView>>(),
  install: vi.fn(),
  resume: vi.fn(),
}));
vi.mock("../storage/next-model-setup", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  NativeModelSetup: class {
    inspect() {
      return m.inspect();
    }
    install() {
      return m.install();
    }
    resume() {
      return m.resume();
    }
  },
}));
const closes: (() => void)[] = [];
beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  vi.clearAllMocks();
  m.inspect.mockResolvedValue({ state: "ready" });
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
async function fixture(creator = false) {
  const f = await nextTaskFixture();
  closes.push(f.close);
  const noWrite = vi.fn(async (): Promise<never> => {
    throw Error("No setup mutation expected");
  });
  const journal: ModelSetupJournal = {
    scope: {
      account: f.accountId,
      installation: crypto.randomUUID(),
      collection: f.client.hello.collection,
    },
    load: vi.fn(async () => null),
    prepare: noWrite,
    recordAttempt: noWrite,
    recordConfirmed: noWrite,
    recordVerified: noWrite,
  };
  const assess = vi.fn(async () => {});
  const verified = vi.fn(async () => {});
  const repository = new NextTaskRepository(
    f.client,
    "Original configured collection",
    f.accountId,
    {
      clientOwnership: "borrowed",
      modelSetupJournal: journal,
      requiresTaskNotesModelSetup: creator,
      onModelSetupVerified: verified,
      onModelSetupAssessment: assess,
    },
  );
  closes.push(() => repository.dispose());
  return { ...f, repository, journal, assess, verified, noWrite };
}

function renderShell(repository: NextTaskRepository) {
  return render(
    <CollectionGateContext.Provider
      value={{
        authorizeAnotherCollection: vi.fn(),
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
      { name: "Today" },
    ),
  ).toBeVisible();
  expect(localStorage.getItem("tasknotes:navigation-views:v4")).toBe(
    preferences,
  );
  expect(screen.queryByText("No views yet.")).not.toBeInTheDocument();
});

it("offers explicit view creation for a genuinely empty native catalog, without recreating defaults", async () => {
  const f = await fixture();
  vi.spyOn(f.client, "listAppBasesViews").mockResolvedValue({
    kind: "success",
    views: [],
    continuation: null,
    clock: { instant: 1, tz: "UTC", localDate: "1970-01-01" },
    collectionRevision: "sha256:" + "ab".repeat(32),
  });
  const create = vi.spyOn(f.repository, "createViewSource");
  renderShell(f.repository);
  expect(await screen.findByText("No views yet.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Create a view" }));
  expect(
    await screen.findByRole("heading", { name: "New view" }),
  ).toBeVisible();
  expect(create).not.toHaveBeenCalled();
});

it.each([
  { changes: 0, label: "a quiet collection" },
  {
    changes: 1,
    label: "a first-load conflict followed by success without user action",
  },
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
    let onChanges: Parameters<typeof f.client.watchChanges>[1] | undefined;
    vi.spyOn(f.client, "watchChanges").mockImplementation(
      (cursor, listener) => {
        onChanges = listener;
        return originalWatch(cursor, listener);
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
          authorizeAnotherCollection: vi.fn(),
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
      await within(navigation).findByRole("button", { name: "Today" }),
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
    expect(f.assess).toHaveBeenCalledWith("ready", expect.any(AbortSignal));
    expect(
      screen.queryByRole("button", { name: "Set up TaskNotes" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Finish opening TaskNotes"),
    ).not.toBeInTheDocument();
    expect(m.install).not.toHaveBeenCalled();
    expect(m.resume).not.toHaveBeenCalled();
    expect(f.verified).not.toHaveBeenCalled();
    expect(f.noWrite).not.toHaveBeenCalled();
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

it("keeps a genuinely unconfigured collection on its setup screen without automatically installing", async () => {
  const f = await fixture();
  f.catalog.types = [];
  f.catalog.contracts = [];
  vi.spyOn(f.client, "describe").mockResolvedValue(f.catalog);
  m.inspect.mockResolvedValue({ state: "required" });
  const mounted = render(
    <CollectionGateContext.Provider
      value={{
        authorizeAnotherCollection: vi.fn(),
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
  expect(
    await screen.findByRole("button", { name: "Set up TaskNotes" }),
  ).toBeVisible();
  await waitFor(() =>
    expect(f.assess).toHaveBeenCalledWith(
      "setup_required",
      expect.any(AbortSignal),
    ),
  );
  expect(
    screen.queryByRole("complementary", { name: "Primary" }),
  ).not.toBeInTheDocument();
  expect(m.install).not.toHaveBeenCalled();
  expect(m.resume).not.toHaveBeenCalled();
  expect(f.verified).not.toHaveBeenCalled();
  expect(f.noWrite).not.toHaveBeenCalled();
  mounted.unmount();
});

it("publishes setup-required only for a real required inspection and never completes a creator", async () => {
  const f = await fixture(true);
  m.inspect.mockResolvedValue({ state: "required" });
  await expect(f.repository.modelSetup!.inspect()).resolves.toEqual({
    state: "required",
  });
  expect(f.assess).toHaveBeenCalledWith(
    "setup_required",
    expect.any(AbortSignal),
  );
  expect(f.verified).not.toHaveBeenCalled();
  expect(f.noWrite).not.toHaveBeenCalled();
});

it.each<ModelSetupView>([
  { state: "blocked", message: "Original read unavailable" },
  { state: "outcome_unknown", message: "Preserve original operation" },
  { state: "permission_required", message: "Permission unavailable" },
])("does not publish ready from a $state inspection", async (view) => {
  const f = await fixture();
  m.inspect.mockResolvedValue(view);
  await expect(f.repository.modelSetup!.inspect()).resolves.toEqual(view);
  expect(f.assess).not.toHaveBeenCalled();
});

it("does not bypass the original creator gate even when the current inspection reads ready", async () => {
  const f = await fixture(true);
  await expect(f.repository.modelSetup!.inspect()).rejects.toThrow(
    "Complete this original collection",
  );
  expect(f.assess).not.toHaveBeenCalled();
  expect(f.verified).not.toHaveBeenCalled();
});

it("refuses a readiness result delivered after the original repository was disposed", async () => {
  const f = await fixture();
  let finish!: (view: ModelSetupView) => void;
  m.inspect.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = f.repository.modelSetup!.inspect();
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  f.repository.dispose();
  finish({ state: "ready" });
  await expect(pending).rejects.toThrow();
  expect(f.assess).not.toHaveBeenCalled();
});
