import "fake-indexeddb/auto";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RepositoryProvider } from "../app/repository-context";
import { MarkdownCollection } from "../storage/collection";
import { TaskIndex } from "../storage/index";
import { IndexedMarkdownRepository } from "../storage/repository";
import { MemoryVault } from "../test/memory-vault";
import { TaskModelSettingsEditor } from "./task-model-settings";

describe("TaskModelSettingsEditor", () => {
  let repository: IndexedMarkdownRepository;
  let index: TaskIndex;

  beforeEach(async () => {
    index = new TaskIndex(`task-model-settings-${crypto.randomUUID()}`);
    repository = new IndexedMarkdownRepository({
      collection: new MarkdownCollection(new MemoryVault()),
      index,
    });
    await repository.initialize();
  });

  afterEach(async () => {
    index.close();
    await index.delete();
  });

  it("saves defaults and behavior through the repository contract", async () => {
    render(
      <RepositoryProvider repository={repository}>
        <TaskModelSettingsEditor />
      </RepositoryProvider>,
    );

    const status = await screen.findByRole("combobox", {
      name: "Default status",
    });
    fireEvent.click(status);
    fireEvent.click(screen.getByRole("option", { name: "In progress" }));
    fireEvent.click(
      screen.getByLabelText("Stop a running timer when its task completes"),
    );
    fireEvent.change(screen.getByLabelText("Future occurrence horizon"), {
      target: { value: "P30D" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save task settings" }));

    expect(
      await screen.findByText("Saved to the type contract."),
    ).toBeVisible();
    await waitFor(async () =>
      expect(await repository.taskConfiguration()).toMatchObject({
        defaults: { status: "in-progress" },
        occurrences: { futureHorizon: "P30D" },
        timeTracking: { autoStopOnComplete: true },
      }),
    );
  });
});
