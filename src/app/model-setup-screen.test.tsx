import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  ModelSetupError,
  TaskNotesModelRequiredError,
  type TaskNotesModelSetup,
} from "../application/ports/model-setup";
import { MemoryMutationJournal } from "../test/memory-mutation-journal";
import { nextTaskFixture } from "../test/next-task-fixture";
import { ModelSetupScreen } from "./model-setup-screen";
import { AppShell } from "./app-shell";
import { CollectionGateContext } from "./collection-context";
import { RepositoryProvider } from "./repository-context";

// Component and protocol stand-ins, not native creation, protected-store
// custody or real grant-approval coverage.
const views = vi.hoisted(() => ({
  mounted: vi.fn(),
  refresh: vi.fn(async () => undefined),
}));
vi.mock("./views-screen", () => ({
  ViewsScreen: () => {
    views.mounted();
    return <p>Task views mounted</p>;
  },
}));
vi.mock("./use-navigation-views", () => ({
  useNavigationViews: () => ({
    documents: [],
    views: [],
    error: "",
    navigationViews: [],
    navigationKeys: [],
    loading: false,
    refresh: views.refresh,
    toggleNavigationView: vi.fn(),
    moveNavigationView: vi.fn(),
  }),
}));
const closes: (() => void)[] = [];
beforeEach(() => {
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
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
const callbacks = {
  authorizeAnotherCollection: () => undefined,
  changeCollection: () => undefined,
  reauthorizeCurrentCollection: () => undefined,
};
function setup(): TaskNotesModelSetup {
  return {
    inspect: vi.fn(async () => ({ state: "required" as const })),
    install: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
  };
}

it("does not mount task views or choose a fallback schema when the model is missing", async () => {
  const f = await nextTaskFixture();
  closes.push(f.close);
  const port = setup();
  Object.defineProperty(f.repository, "modelSetup", { value: port });
  vi.spyOn(f.repository, "initialize").mockRejectedValueOnce(
    new TaskNotesModelRequiredError("Model missing"),
  );
  const mounted = render(
    <CollectionGateContext.Provider value={callbacks}>
      <RepositoryProvider
        repository={f.repository}
        mutationJournal={new MemoryMutationJournal()}
      >
        <AppShell />
      </RepositoryProvider>
    </CollectionGateContext.Provider>,
  );
  await screen.findByRole("button", { name: "Set up TaskNotes" });
  expect(views.mounted).not.toHaveBeenCalled();
  expect(port.install).not.toHaveBeenCalled();
  expect(port.resume).not.toHaveBeenCalled();
  mounted.unmount();
});
async function openingWithSetup(port: TaskNotesModelSetup) {
  const f = await nextTaskFixture();
  closes.push(f.close);
  Object.defineProperty(f.repository, "modelSetup", { value: port });
  const initialize = vi.spyOn(f.repository, "initialize");
  const configuration = vi.spyOn(f.repository, "taskConfiguration");
  const uuid = vi.spyOn(crypto, "randomUUID");
  const mounted = render(
    <CollectionGateContext.Provider value={callbacks}>
      <RepositoryProvider
        repository={f.repository}
        mutationJournal={new MemoryMutationJournal()}
      >
        <AppShell />
      </RepositoryProvider>
    </CollectionGateContext.Provider>,
  );
  return { mounted, initialize, configuration, uuid };
}

it.each([
  { state: "required", visible: "Set up TaskNotes" },
  {
    state: "outcome_unknown",
    message: "Original sources unconfirmed",
    visible: "Resume original setup",
  },
  {
    state: "permission_required",
    message: "Original source permission required",
    visible: "Review collection permission",
  },
  {
    state: "blocked",
    message: "Original sources unavailable",
    visible: "Original sources unavailable",
  },
] as const)(
  "keeps readable task metadata behind explicit $state source setup",
  async ({ visible, ...readiness }) => {
    const port = setup();
    vi.mocked(port.inspect).mockResolvedValue(readiness);
    const opening = await openingWithSetup(port);
    await screen.findByText(visible);
    expect(opening.initialize).toHaveResolved();
    expect(port.inspect).toHaveBeenCalled();
    expect(opening.configuration).not.toHaveBeenCalled();
    expect(views.mounted).not.toHaveBeenCalled();
    expect(port.install).not.toHaveBeenCalled();
    expect(port.resume).not.toHaveBeenCalled();
    expect(opening.uuid).not.toHaveBeenCalled();
    opening.mounted.unmount();
  },
);

it.each([
  { action: "install", state: "required", button: "Set up TaskNotes" },
  {
    action: "resume",
    state: "outcome_unknown",
    button: "Resume original setup",
  },
] as const)(
  "opens readable tasks only after explicit original $action and readiness",
  async ({ action, state, button }) => {
    const port = setup();
    vi.mocked(port.inspect).mockResolvedValue(
      state === "required"
        ? { state }
        : { state, message: "Original receipt unconfirmed" },
    );
    vi.mocked(port[action]).mockImplementation(async () => {
      vi.mocked(port.inspect).mockResolvedValue({ state: "ready" });
    });
    const opening = await openingWithSetup(port);
    const control = await screen.findByRole("button", { name: button });
    expect(opening.configuration).not.toHaveBeenCalled();
    expect(views.mounted).not.toHaveBeenCalled();
    expect(opening.uuid).not.toHaveBeenCalled();
    fireEvent.click(control);
    await screen.findByText("Task views mounted");
    expect(port[action]).toHaveBeenCalledOnce();
    expect(
      port[action === "install" ? "resume" : "install"],
    ).not.toHaveBeenCalled();
    expect(opening.configuration).toHaveBeenCalled();
    opening.mounted.unmount();
  },
);

it("opens readable task metadata after read-only source readiness without completing a creator", async () => {
  const port = setup();
  vi.mocked(port.inspect).mockResolvedValue({ state: "ready" });
  const opening = await openingWithSetup(port);
  await waitFor(() => expect(opening.configuration).toHaveBeenCalled());
  expect(port.inspect).toHaveBeenCalledOnce();
  expect(port.install).not.toHaveBeenCalled();
  expect(port.resume).not.toHaveBeenCalled();
  expect(opening.uuid).not.toHaveBeenCalled();
  opening.mounted.unmount();
});

it("does not publish source readiness after the opening owner unmounts", async () => {
  const port = setup();
  let ready!: () => void;
  vi.mocked(port.inspect).mockImplementation(
    () =>
      new Promise((resolve) => {
        ready = () => resolve({ state: "ready" });
      }),
  );
  const opening = await openingWithSetup(port);
  await waitFor(() => expect(port.inspect).toHaveBeenCalledOnce());
  opening.mounted.unmount();
  await act(async () => ready());
  expect(opening.configuration).not.toHaveBeenCalled();
  expect(views.mounted).not.toHaveBeenCalled();
  expect(port.install).not.toHaveBeenCalled();
  expect(port.resume).not.toHaveBeenCalled();
  expect(opening.uuid).not.toHaveBeenCalled();
});

it("installs only after the explicit action and reopens the original repository after readiness", async () => {
  const port = setup();
  const onReady = vi.fn(async () => undefined);
  vi.mocked(port.install).mockImplementation(async () => {
    vi.mocked(port.inspect).mockResolvedValue({ state: "ready" });
  });
  render(
    <ModelSetupScreen
      setup={port}
      onReady={onReady}
      changeCollection={vi.fn()}
      reauthorizeCollection={vi.fn()}
    />,
  );
  await screen.findByRole("button", { name: "Set up TaskNotes" });
  expect(port.install).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Set up TaskNotes" }));
  await waitFor(() => expect(onReady).toHaveBeenCalledOnce());
  expect(port.install).toHaveBeenCalledOnce();
  expect(port.resume).not.toHaveBeenCalled();
});
it("keeps unknown outcome visible and resumes the original intent instead of installing again", async () => {
  const port = setup();
  const unknown = {
    state: "outcome_unknown" as const,
    message: "Preserve the original collection.",
  };
  vi.mocked(port.install).mockRejectedValue(new ModelSetupError(unknown));
  const onReady = vi.fn(async () => undefined);
  vi.mocked(port.resume).mockImplementation(async () => {
    vi.mocked(port.inspect).mockResolvedValue({ state: "ready" });
  });
  render(
    <ModelSetupScreen
      setup={port}
      onReady={onReady}
      changeCollection={vi.fn()}
      reauthorizeCollection={vi.fn()}
    />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Set up TaskNotes" }),
  );
  await screen.findByText(/Setup outcome unknown/);
  expect(screen.queryByRole("button", { name: "Set up TaskNotes" })).toBeNull();
  expect(onReady).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Resume original setup" }),
  );
  await waitFor(() => expect(onReady).toHaveBeenCalledOnce());
  expect(port.install).toHaveBeenCalledOnce();
  expect(port.resume).toHaveBeenCalledOnce();
});
it("shows bounded setup and receipt-check progress, retaining unknown outcome without a timeout alert or resubmit", async () => {
  const port = setup();
  let report!: NonNullable<Parameters<TaskNotesModelSetup["install"]>[0]>;
  let reject!: (error: unknown) => void;
  vi.mocked(port.install).mockImplementation((progress) => {
    report = progress!;
    return new Promise<void>((_, failed) => {
      reject = failed;
    });
  });
  const onReady = vi.fn(async () => undefined);
  render(
    <ModelSetupScreen
      setup={port}
      onReady={onReady}
      changeCollection={vi.fn()}
      reauthorizeCollection={vi.fn()}
    />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Set up TaskNotes" }),
  );
  act(() => report("waiting_for_confirmation"));
  await screen.findByText("Waiting for setup confirmation…");
  act(() => report("checking_outcome"));
  await screen.findByText("Checking whether setup finished…");
  act(() => report("waiting_for_confirmation")); // Do not re-label reconciliation as a fresh install.
  expect(screen.getByText("Checking whether setup finished…")).toBeTruthy();
  await act(async () =>
    reject(
      new ModelSetupError({
        state: "outcome_unknown",
        message: "Checking whether setup finished. Original changes retained.",
      }),
    ),
  );
  await screen.findByRole("button", { name: "Resume original setup" });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(port.install).toHaveBeenCalledOnce();
  expect(port.resume).not.toHaveBeenCalled();
  expect(onReady).not.toHaveBeenCalled();
});
it("awaits idempotent completion recording after a ready read-only check", async () => {
  const port = setup();
  vi.mocked(port.inspect).mockResolvedValue({ state: "ready" });
  const steps: string[] = [];
  vi.mocked(port.install).mockImplementation(async () => {
    steps.push("complete original target");
  });
  const onReady = vi.fn(async () => {
    steps.push("open original repository");
  });
  render(
    <ModelSetupScreen
      setup={port}
      onReady={onReady}
      changeCollection={vi.fn()}
      reauthorizeCollection={vi.fn()}
    />,
  );
  const check = await screen.findByRole("button", { name: "Check setup" });
  expect(port.install).not.toHaveBeenCalled();
  fireEvent.click(check);
  await waitFor(() => expect(onReady).toHaveBeenCalledOnce());
  expect(steps).toEqual([
    "complete original target",
    "open original repository",
  ]);
  expect(port.resume).not.toHaveBeenCalled();
});
it("offers explicit permission review without treating READ or a role as definition-write permission", async () => {
  const port = setup();
  vi.mocked(port.inspect).mockResolvedValue({
    state: "permission_required",
    message: "Definition permission required",
  });
  const permission = vi.fn();
  render(
    <ModelSetupScreen
      setup={port}
      onReady={vi.fn()}
      changeCollection={vi.fn()}
      reauthorizeCollection={permission}
    />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Review collection permission" }),
  );
  expect(permission).toHaveBeenCalledOnce();
  expect(port.install).not.toHaveBeenCalled();
  expect(port.resume).not.toHaveBeenCalled();
});
