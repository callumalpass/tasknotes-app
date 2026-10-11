import { render, screen, waitFor, within } from "@testing-library/react";
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

it("opens a fresh browser into the existing Today navigation and task rows, without setup or new writes", async () => {
  const f = await fixture();
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
  vi.spyOn(f.client, "listAppBasesViews").mockResolvedValue({
    kind: "success",
    views: [view],
    clock,
    collectionRevision: revision,
    continuation: null,
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
  mounted.unmount();
});

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
