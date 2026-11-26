import "fake-indexeddb/auto";

import { fireEvent, render, screen, waitFor } from "../test/render";
import { describe, expect, it, vi } from "vitest";

import { RepositoryProvider } from "../app/repository-context";
import {
  nextTaskFixture,
  seedRecord,
  seedTask,
} from "../test/next-task-fixture";
import { MemoryMutationJournal } from "../test/memory-mutation-journal";
import { TaskNotesTaskModel } from "../domain/tasknotes-model";
import { TaskModelSettingsEditor } from "./task-model-settings";
import { customFieldKey } from "./task-vocabulary-editor";

type Part = "properties" | "behavior";

async function renderEditor(
  prepare?: (fixture: Awaited<ReturnType<typeof nextTaskFixture>>) => void,
  part: Part = "behavior",
) {
  const fixture = await nextTaskFixture();
  const { repository } = fixture;
  prepare?.(fixture);
  await repository.initialize();
  const journal = new MemoryMutationJournal();
  // Leaving Settings unmounts the editor; the collection stays open.
  const tree = (editor: boolean, shown: Part = part) => (
    <RepositoryProvider mutationJournal={journal} repository={repository}>
      {editor ? <TaskModelSettingsEditor key={shown} part={shown} /> : null}
    </RepositoryProvider>
  );
  const view = render(tree(true));
  await waitFor(() =>
    expect(
      part === "behavior"
        ? screen.getByRole("combobox", { name: "Default priority" })
        : screen.getByRole("button", { name: "Add status" }),
    ).toBeEnabled(),
  );
  return { view, tree, repository };
}

function save() {
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
}

describe("TaskModelSettingsEditor", () => {
  it("displays the contextual source label after settings access fails", async () => {
    const { repository } = await nextTaskFixture();
    await repository.initialize();
    const access = vi
      .spyOn(repository, "taskModelSettingsAccess")
      .mockRejectedValue(new Error("Authority refused access"));
    render(
      <RepositoryProvider
        mutationJournal={new MemoryMutationJournal()}
        repository={repository}
      >
        <TaskModelSettingsEditor part="behavior" />
      </RepositoryProvider>,
    );

    expect(await screen.findByText("Collection settings")).toHaveClass(
      "settings-source",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Authority refused access",
    );
    expect(
      screen.getByRole("combobox", { name: "Default priority" }),
    ).toBeDisabled();
    expect(access).toHaveBeenCalledTimes(1);
  });

  it("keeps unsaved choices when Settings is left and offers Discard", async () => {
    const { view, tree } = await renderEditor();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Start new tasks from a template" }),
    );
    expect(screen.getByText(/Unsaved changes/)).toBeVisible();
    view.rerender(tree(false));

    view.rerender(tree(true));
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

  it("adds a status and a custom field to the collection", async () => {
    const { repository, view, tree } = await renderEditor(
      undefined,
      "properties",
    );
    fireEvent.click(screen.getByRole("button", { name: "Add status" }));
    const names = screen.getAllByRole("textbox", { name: "Status name" });
    fireEvent.change(names.at(-1)!, { target: { value: "Waiting on reply" } });
    // The stored value is shown before it is saved, and follows the name.
    expect(screen.getByText("waiting-on-reply")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Add field" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Field name" }), {
      target: { value: "Client" },
    });
    save();

    await waitFor(() =>
      expect(screen.getByText("Saved with the collection.")).toBeVisible(),
    );
    const configuration = await repository.taskConfiguration();
    expect(configuration.statuses.at(-1)).toMatchObject({
      value: "waiting-on-reply",
      label: "Waiting on reply",
      isCompleted: false,
    });
    expect(configuration.userFields).toContainEqual(
      expect.objectContaining({ key: "client", displayName: "Client" }),
    );
    // The saved status is now offered as a default for new tasks.
    view.rerender(tree(true, "behavior"));
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Default status" }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("combobox", { name: "Default status" }));
    expect(
      screen.getByRole("option", { name: "Waiting on reply" }),
    ).toBeVisible();
  });

  it("carries an unsaved change between the two sections and saves it from either", async () => {
    const { repository, view, tree } = await renderEditor(
      undefined,
      "properties",
    );
    fireEvent.click(screen.getByRole("button", { name: "Add status" }));
    fireEvent.change(
      screen.getAllByRole("textbox", { name: "Status name" }).at(-1)!,
      { target: { value: "Blocked" } },
    );
    view.rerender(tree(true, "behavior"));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Save changes" }),
      ).toBeEnabled(),
    );
    save();
    await waitFor(() =>
      expect(screen.getByText("Saved with the collection.")).toBeVisible(),
    );
    expect(
      (await repository.taskConfiguration()).statuses.map(({ label }) => label),
    ).toContain("Blocked");
  });

  it("asks for a name before saving a new priority", async () => {
    const { repository } = await renderEditor(undefined, "properties");
    const before = await repository.taskConfiguration();
    fireEvent.click(screen.getByRole("button", { name: "Add priority" }));
    save();
    expect(
      await screen.findByText("Give every priority a name."),
    ).toBeVisible();
    expect(await repository.taskConfiguration()).toEqual(before);
  });

  it("keeps the default status and says why a status in use stays", async () => {
    const { repository } = await renderEditor(({ replica }) => {
      seedTask(replica, { title: "Still here", status: "in-progress" });
      seedTask(replica, { title: "And here", status: "in-progress" });
    }, "properties");
    const configuration = await repository.taskConfiguration();
    const label = (value: string) =>
      configuration.statuses.find((status) => status.value === value)!.label;
    expect(
      screen.getByRole("button", {
        name: `Remove ${label(configuration.defaults.status)}`,
      }),
    ).toBeDisabled();

    fireEvent.click(
      screen.getByRole("button", { name: `Remove ${label("in-progress")}` }),
    );
    save();
    expect(
      await screen.findByText(
        `2 tasks still have the status “${label("in-progress")}”. Move them to another status, then remove this one.`,
      ),
    ).toBeVisible();
    expect(
      (await repository.taskConfiguration()).statuses.map(({ value }) => value),
    ).toContain("in-progress");
  });

  it("preserves mixed-case custom field names like effortPoints on storage and reads matching files", async () => {
    const { repository } = await renderEditor(({ replica }) => {
      seedRecord(replica, {
        path: "tasks/estimate.md",
        types: ["task"],
        frontmatter: {
          id: "estimate",
          title: "Estimate work",
          status: "open",
          tags: ["task"],
          dateCreated: "2026-07-22T00:00:00Z",
          effortPoints: 5,
        },
      });
    }, "properties");

    fireEvent.click(screen.getByRole("button", { name: "Add field" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Field name" }), {
      target: { value: "effortPoints" },
    });
    expect(screen.getByText("effortPoints")).toBeVisible();
    // Choose Number type so the schema matches numeric effortPoints in the file.
    fireEvent.click(
      screen.getByRole("combobox", { name: "Type of effortPoints" }),
    );
    fireEvent.click(screen.getByRole("option", { name: "Number" }));
    save();

    await waitFor(() =>
      expect(screen.getByText("Saved with the collection.")).toBeVisible(),
    );
    const configuration = await repository.taskConfiguration();
    expect(configuration.userFields).toContainEqual(
      expect.objectContaining({
        key: "effortPoints",
        displayName: "effortPoints",
      }),
    );

    const tasks = await repository.listSummaries({ limit: 10 });
    expect(tasks[0]?.customProperties).toEqual({ effortPoints: 5 });
  });

  it("deduplicates mixed-case custom field keys case-insensitively and reads legacy differing-case keys", () => {
    expect(customFieldKey("effortPoints", [])).toBe("effortPoints");
    expect(customFieldKey("EffortPoints", [])).toBe("EffortPoints");
    expect(customFieldKey("effortPoints", ["effortpoints"])).toBe(
      "effortPoints_2",
    );
    expect(customFieldKey("Client", [])).toBe("client");
    expect(customFieldKey("Story points", [])).toBe("story_points");

    const model = new TaskNotesTaskModel({
      userFields: [
        {
          id: "effortpoints",
          key: "effortpoints",
          displayName: "effortPoints",
          type: "number",
        },
      ],
    });
    const read = model.readSummary({
      path: "tasks/one.md",
      frontmatter: {
        id: "one",
        title: "Legacy casing",
        status: "open",
        effortPoints: 8,
      },
    });
    expect(read.customProperties).toEqual({ effortpoints: 8 });
  });
});
