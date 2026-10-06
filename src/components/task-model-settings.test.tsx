import "fake-indexeddb/auto";

import { fireEvent, render, screen, waitFor } from "../test/render";
import { describe, expect, it } from "vitest";

import { RepositoryProvider } from "../app/repository-context";
import { createTestMdbaseRepository } from "../test/mdbase-fixture";
import { MemoryMutationJournal } from "../test/memory-mutation-journal";
import { TaskModelSettingsEditor } from "./task-model-settings";

async function renderEditor() {
  const repository = createTestMdbaseRepository();
  await repository.initialize();
  const element = (
    <RepositoryProvider
      mutationJournal={new MemoryMutationJournal()}
      repository={repository}
    >
      <TaskModelSettingsEditor />
    </RepositoryProvider>
  );
  const view = render(element);
  await waitFor(() =>
    expect(
      screen.getByRole("combobox", { name: "Default priority" }),
    ).toBeEnabled(),
  );
  return { view, element };
}

describe("TaskModelSettingsEditor", () => {
  it("keeps unsaved choices when Settings is left and offers Discard", async () => {
    const { view, element } = await renderEditor();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Start new tasks from a template" }),
    );
    expect(screen.getByText(/Unsaved changes/)).toBeVisible();
    view.unmount();

    render(element);
    expect(
      await screen.findByRole("checkbox", {
        name: "Start new tasks from a template",
      }),
    ).toBeChecked();
    expect(screen.getByText(/Unsaved changes/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(
      screen.getByRole("checkbox", { name: "Start new tasks from a template" }),
    ).not.toBeChecked();
    expect(screen.queryByText(/Unsaved changes/)).not.toBeInTheDocument();
  });

  it("shows dependent fields only when they apply", async () => {
    await renderEditor();
    expect(screen.queryByLabelText("Template file")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Archive folder")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Keep files for past dates"),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Start new tasks from a template" }),
    );
    expect(screen.getByLabelText("Template file")).toBeVisible();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Move archived task files into a folder",
      }),
    );
    expect(screen.getByLabelText("Archive folder")).toBeVisible();

    fireEvent.click(
      screen.getByRole("combobox", {
        name: "Create a task file for each date",
      }),
    );
    fireEvent.click(screen.getByRole("option", { name: /upcoming window/ }));
    expect(screen.getByText("Keep files for past dates")).toBeVisible();
    expect(
      screen.queryByRole("checkbox", { name: /skipped/ }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("combobox", {
        name: "Create a task file for each date",
      }),
    );
    fireEvent.click(
      screen.getByRole("option", { name: /previous one is completed/ }),
    );
    expect(screen.getByRole("checkbox", { name: /skipped/ })).toBeVisible();
    expect(
      screen.queryByText("Keep files for past dates"),
    ).not.toBeInTheDocument();
  });
});
