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
  // Connect core refuses setup with this code when a plain file holds a path
  // the type pack manages; the SDK has no copy for it (issue #436).
  expect(describeError("collection_setup_namespace_conflict")?.title).toBe(
    "Something went wrong",
  );
  expect(
    openProblemReference(phase("collection_setup_namespace_conflict")),
  ).toEqual({
    code: "collection_setup_namespace_conflict",
    developerMessage: expect.stringContaining(
      "collection_setup_namespace_conflict",
    ),
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
      problem: "collection_setup_namespace_conflict",
    } as never),
  );
  expect(
    await screen.findByRole("heading", { name: "Can't open Vault" }),
  ).toBeVisible();
  expect(screen.getByText("Something went wrong")).toBeVisible();
  fireEvent.click(screen.getByText("Technical details"));
  expect(screen.getByText("collection_setup_namespace_conflict")).toBeVisible();
  expect(warn).toHaveBeenCalledWith(
    expect.stringContaining("collection_setup_namespace_conflict"),
    expect.any(String),
  );
  warn.mockRestore();
});
