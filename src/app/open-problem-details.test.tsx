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
  // An error-severity problem whose copy names no cause: the code is the only
  // thing support can act on. Use a code the SDK keeps on its generic copy;
  // specific codes gain their own copy over time (as
  // collection_setup_namespace_conflict did for issue #436).
  expect(describeError("internal")?.severity).toBe("error");
  expect(openProblemReference(phase("internal"))).toEqual({
    code: "internal",
    developerMessage: describeError("internal")?.developerMessage ?? null,
  });
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
      problem: "internal",
    } as never),
  );
  expect(
    await screen.findByRole("heading", { name: "Can't open Vault" }),
  ).toBeVisible();
  expect(screen.getByText(describeError("internal")!.title)).toBeVisible();
  fireEvent.click(screen.getByText("Technical details"));
  expect(screen.getByText("internal")).toBeVisible();
  expect(warn).toHaveBeenCalledWith(
    expect.stringContaining("internal"),
    expect.any(String),
  );
  warn.mockRestore();
});
