import { act, fireEvent, render, screen } from "../test/render";
import { expect, it, vi } from "vitest";
import { createTestMdbase } from "@mdbase-dev/sdk/testing";
import type { MdbaseSnapshot } from "@mdbase-dev/sdk";
import { describeError } from "@mdbase-dev/sdk/describe";

vi.mock("../storage/next-repository", () => ({
  NextTaskRepository: class {
    constructor(readonly records: unknown) {}
    taskConfiguration = async () => ({});
    dispose() {}
  },
}));

import { TaskNotesApp } from "./tasknotes-app";
import { openProblemReference } from "./open-problem-reference";

const phase = (problem: string) =>
  ({
    phase: {
      kind: "problem",
      collectionId: "c",
      problem: describeError(problem)!,
    },
  }) as Pick<MdbaseSnapshot, "phase">;

it("names the code behind the generic copy, and nothing for actionable problems", () => {
  // An unclassified code reads "Something went wrong" (issue #436).
  expect(describeError("replica_open_failed")?.title).toBe(
    "Something went wrong",
  );
  expect(openProblemReference(phase("replica_open_failed"))).toEqual({
    code: "replica_open_failed",
    developerMessage: expect.stringContaining("replica_open_failed"),
  });
  expect(openProblemReference(phase("internal"))?.code).toBe("internal");
  // Warnings and information already say what to do.
  expect(openProblemReference(phase("device_offline"))).toBeNull();
  expect(openProblemReference(phase("setup_required"))).toBeNull();
});

it("shows the SDK's code under the shared problem screen", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const mdbase = await createTestMdbase({ collections: [{ name: "Vault" }] });
  const before = mdbase.fixture.mdbase.getSnapshot();
  render(
    <TaskNotesApp
      mdbase={mdbase}
      Workspace={(() => <main>Workspace</main>) as never}
    />,
  );
  act(() =>
    mdbase.fixture.controls.publishSnapshot({
      ...before,
      status: "blocked",
      problem: "replica_open_failed",
    } as never),
  );
  expect(
    await screen.findByRole("heading", { name: "Can't open Vault" }),
  ).toBeVisible();
  expect(screen.getByText("Something went wrong")).toBeVisible();
  fireEvent.click(screen.getByText("Technical details"));
  expect(screen.getByText("replica_open_failed")).toBeVisible();
  expect(warn).toHaveBeenCalledWith(
    expect.stringContaining("replica_open_failed"),
    expect.any(String),
  );
  warn.mockRestore();
});
