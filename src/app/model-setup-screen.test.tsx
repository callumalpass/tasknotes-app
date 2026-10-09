import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
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
