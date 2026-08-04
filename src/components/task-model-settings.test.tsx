import "fake-indexeddb/auto";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RepositoryProvider } from "../app/repository-context";
import { createTestMdbaseRepository } from "../test/mdbase-fixture";
import { MemoryMutationJournal } from "../test/memory-mutation-journal";
import { TaskModelSettingsEditor } from "./task-model-settings";

describe("TaskModelSettingsEditor", () => {
  it("shows authoritative mdbase type settings as read-only", async () => {
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

    expect(
      await screen.findByText(
        "Connected collection type settings are managed by the collection owner.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("group", { name: "Task model settings" }),
    ).toBeDisabled();
  });
});
