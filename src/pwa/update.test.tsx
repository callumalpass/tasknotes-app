import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => vi.resetModules());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function fixture(controlled = true) {
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
      <AppUpdateNotice reload={reload} />
    </>,
  );
  async function activate(next: object | null = {}) {
    workers.controller = next;
    await act(() => workers.dispatchEvent(new Event("controllerchange")));
  }
  return { workers, addListener, initializePwaUpdate, reload, activate };
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
  fireEvent.click(screen.getByRole("button", { name: "Reload TaskNotes" }));
  expect(f.reload).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Reloading…" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Reloading…" }));
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
    screen.getByRole("button", { name: "Reload TaskNotes" }),
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
