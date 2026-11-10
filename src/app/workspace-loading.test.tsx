import { Component, type ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { createTestMdbase } from "@mdbase-dev/sdk/testing";

import { render, screen } from "../test/render";

// The workspace's code is fetched apart from the app: each import here is one
// fetch, and the first `failures` of them fail.
const fetches = vi.hoisted(() => ({ made: 0, failures: 0 }));
vi.mock("./held-collection", () => {
  if (fetches.made++ < fetches.failures) throw new Error("chunk not fetched");
  return { ReadyCollection: () => <main>Workspace</main> };
});

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? <p>Needs restart</p> : this.props.children;
  }
}

async function open() {
  vi.resetModules();
  const { TaskNotesApp } = await import("./tasknotes-app");
  const mdbase = await createTestMdbase({ collections: [{ name: "Alpha" }] });
  render(
    <Boundary>
      <TaskNotesApp mdbase={mdbase} />
    </Boundary>,
  );
}

afterEach(() => vi.restoreAllMocks());

// A fetched module stays fetched, so the failure that never ends runs first.
it("hands a workspace that cannot be fetched to the app's error boundary", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  fetches.made = 0;
  fetches.failures = Infinity;
  await open();
  expect(await screen.findByText("Needs restart")).toBeVisible();
  expect(screen.queryByText("Workspace")).toBeNull();
});

it("fetches the workspace again when the early fetch failed", async () => {
  fetches.made = 0;
  fetches.failures = 1;
  await open();
  expect(await screen.findByText("Workspace")).toBeVisible();
  expect(fetches.made).toBe(2);
});
