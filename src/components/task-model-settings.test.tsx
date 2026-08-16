import "fake-indexeddb/auto";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RepositoryProvider } from "../app/repository-context";
import { createTestMdbaseRepository } from "../test/mdbase-fixture";
import { MemoryMutationJournal } from "../test/memory-mutation-journal";
import { TaskModelSettingsEditor } from "./task-model-settings";

describe("TaskModelSettingsEditor", () => {
  it("updates authoritative mdbase type settings", async () => {
    const repository = createTestMdbaseRepository();
    await repository.initialize();

    render(
      <RepositoryProvider
        mutationJournal={new MemoryMutationJournal()}
        repository={repository}
      >
        <TaskModelSettingsEditor />
      </RepositoryProvider>,
    );

    const priority = await screen.findByRole("combobox", {
      name: "Default priority",
    });
    expect(priority).toBeEnabled();
    fireEvent.click(priority);
    fireEvent.click(screen.getByRole("option", { name: "High" }));
    fireEvent.click(screen.getByRole("button", { name: "Save task settings" }));

    await waitFor(async () =>
      expect((await repository.taskConfiguration()).defaults.priority).toBe(
        "high",
      ),
    );
    expect(await screen.findByText("Saved with the collection.")).toBeVisible();
  });
});
