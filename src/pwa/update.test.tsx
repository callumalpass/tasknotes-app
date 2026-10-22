import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.doUnmock("../service-worker-registration");
});

async function fixture(controlled = true, save = vi.fn(async () => {})) {
  const workers = Object.assign(new EventTarget(), {
    controller: controlled ? {} : null,
  });
  const addListener = vi.spyOn(workers, "addEventListener");
  vi.stubGlobal("navigator", { serviceWorker: workers });
  const { initializePwaUpdate } = await import("./update");
  const { AppUpdateNotice } = await import("../components/app-update-notice");
  const reload = vi.fn();
  initializePwaUpdate();
  render(
    <>
      <input aria-label="Unsaved task" defaultValue="Keep this draft" />
      <AppUpdateNotice reload={reload} save={save} />
    </>,
  );
  async function activate(next: object | null = {}) {
    workers.controller = next;
    await act(() => workers.dispatchEvent(new Event("controllerchange")));
  }
  return { workers, addListener, initializePwaUpdate, reload, save, activate };
}

it("does not mistake a first install for an update", async () => {
  const f = await fixture(false);
  await f.activate();
  expect(
    screen.queryByRole("complementary", { name: "App update" }),
  ).toBeNull();
  expect(f.reload).not.toHaveBeenCalled();
});

it("offers an explicit reload after activation without touching the draft or focus", async () => {
  const f = await fixture();
  const input = screen.getByRole("textbox", { name: "Unsaved task" });
  input.focus();
  await f.activate();
  expect(screen.getByRole("status")).toHaveTextContent("Save your changes");
  expect(input).toHaveValue("Keep this draft");
  expect(input).toHaveFocus();
  expect(f.reload).not.toHaveBeenCalled();
  await act(async () =>
    fireEvent.click(
      screen.getByRole("button", { name: "Save and reload TaskNotes" }),
    ),
  );
  expect(f.reload).toHaveBeenCalledOnce();
  expect(f.save).toHaveBeenCalledOnce();
  expect(
    screen.getByRole("button", { name: "Saving changes…" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Saving changes…" }));
  expect(f.reload).toHaveBeenCalledOnce();
});

it("lets the user defer the update and only offers another prompt for a new controller", async () => {
  const f = await fixture();
  const next = {};
  await f.activate(next);
  fireEvent.click(screen.getByRole("button", { name: "Later" }));
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByRole("textbox")).toHaveValue("Keep this draft");
  await f.activate(next);
  expect(screen.queryByRole("status")).toBeNull();
  await f.activate();
  expect(
    screen.getByRole("button", { name: "Save and reload TaskNotes" }),
  ).toBeVisible();
  expect(f.reload).not.toHaveBeenCalled();
});

it("registers one listener and ignores a temporary loss of control", async () => {
  const f = await fixture();
  f.initializePwaUpdate();
  expect(f.addListener).toHaveBeenCalledOnce();
  await f.activate(null);
  expect(screen.queryByRole("status")).toBeNull();
  await f.activate();
  expect(screen.getByRole("status")).toBeVisible();
});

it("stays unavailable when service workers are unsupported", async () => {
  vi.stubGlobal("navigator", {});
  const { initializePwaUpdate } = await import("./update");
  const { AppUpdateNotice } = await import("../components/app-update-notice");
  expect(initializePwaUpdate).not.toThrow();
  render(<AppUpdateNotice />);
  expect(screen.queryByRole("status")).toBeNull();
});

it("keeps the draft and permits retry when saving fails", async () => {
  const save = vi.fn<() => Promise<void>>(async () => {
    throw new Error("Review the conflicting edit first.");
  });
  const f = await fixture(true, save);
  await f.activate();
  await act(async () =>
    fireEvent.click(
      screen.getByRole("button", { name: "Save and reload TaskNotes" }),
    ),
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Review the conflicting edit first.",
  );
  expect(screen.getByRole("textbox")).toHaveValue("Keep this draft");
  expect(f.reload).not.toHaveBeenCalled();
  save.mockImplementation(async () => {});
  await act(async () =>
    fireEvent.click(
      screen.getByRole("button", { name: "Save and reload TaskNotes" }),
    ),
  );
  expect(f.reload).toHaveBeenCalledOnce();
});

it("coalesces visible focus rechecks and ignores hidden/offline checks", async () => {
  let release!: () => void;
  const update = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  vi.doMock("../service-worker-registration", () => ({
    registerTaskNotesServiceWorker: async () =>
      Object.assign(new EventTarget(), {
        update,
        waiting: null,
        installing: null,
      }),
  }));
  const focusSpy = vi.spyOn(window, "addEventListener");
  const visibilitySpy = vi.spyOn(document, "addEventListener");
  const visible = vi
    .spyOn(document, "visibilityState", "get")
    .mockReturnValue("visible");
  await fixture();
  const focus = focusSpy.mock.calls.find(
    ([event]) => String(event) === "focus",
  )![1] as () => void;
  const visibility = visibilitySpy.mock.calls.find(
    ([event]) => event === "visibilitychange",
  )![1] as () => void;
  focus();
  visibility();
  await act(async () => {});
  expect(update).toHaveBeenCalledOnce();
  release();
  await act(async () => {});
  visible.mockReturnValue("hidden");
  visibility();
  await act(async () => {});
  expect(update).toHaveBeenCalledOnce();
  visible.mockReturnValue("visible");
  update.mockImplementation(() => Promise.reject(new Error("offline")));
  focus();
  await act(async () => {});
  expect(update).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("status")).toBeNull();
  focusSpy.mockRestore();
  visibilitySpy.mockRestore();
  visible.mockRestore();
  vi.doUnmock("../service-worker-registration");
});

it("offers an installed waiting worker without forcing activation and respects Later", async () => {
  const worker = Object.assign(new EventTarget(), { state: "installing" });
  const registration = Object.assign(new EventTarget(), {
    installing: worker,
    waiting: null,
    update: vi.fn(async () => {}),
  });
  vi.doMock("../service-worker-registration", () => ({
    registerTaskNotesServiceWorker: async () => registration,
  }));
  const f = await fixture();
  await act(async () => {});
  expect(screen.queryByRole("status")).toBeNull();
  worker.state = "installed";
  await act(async () => worker.dispatchEvent(new Event("statechange")));
  expect(screen.getByRole("status")).toBeVisible();
  expect(f.reload).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Later" }));
  await act(async () => registration.dispatchEvent(new Event("updatefound")));
  expect(screen.queryByRole("status")).toBeNull();
});

it("activates the installed shell only after saving and waits for its controller before reloading", async () => {
  sessionStorage.setItem("tasknotes-update-reload", "1");
  const waiting = Object.assign(new EventTarget(), {
    state: "installed",
    postMessage: vi.fn(),
  });
  const registration = Object.assign(new EventTarget(), {
    waiting,
    installing: null,
    update: vi.fn(async () => {}),
  });
  vi.doMock("../service-worker-registration", () => ({
    registerTaskNotesServiceWorker: async () => registration,
  }));
  const f = await fixture();
  await act(async () => {});
  expect(screen.getByRole("status")).toBeVisible();
  expect(waiting.postMessage).not.toHaveBeenCalled();
  await act(async () =>
    fireEvent.click(
      screen.getByRole("button", { name: "Save and reload TaskNotes" }),
    ),
  );
  expect(f.save).toHaveBeenCalledOnce();
  expect(waiting.postMessage).toHaveBeenCalledWith({
    type: "mdbase-shell:activate",
  });
  expect(f.reload).not.toHaveBeenCalled();
  await f.activate(waiting);
  expect(f.reload).toHaveBeenCalledOnce();
  expect(screen.getByRole("textbox")).toHaveValue("Keep this draft");
});
