import "fake-indexeddb/auto";

import { connect, type MdbaseClient } from "@mdbase-dev/sdk";
import { createTestMdbase } from "@mdbase-dev/sdk/testing";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { MemoryMutationJournal } from "../test/memory-mutation-journal";
import { attachTaskNotes } from "../test/next-task-fixture";
import { RepositoryProvider } from "./repository-context";
import { TaskScreen } from "./task-screen";

import type { NextTaskRepository } from "../storage/next-repository";

const accountId = crypto.randomUUID();

/** One page load: a client over the device's replica, and the task screen. */
async function openPage(
  replica: Parameters<typeof attachTaskNotes>[0],
  client: MdbaseClient,
  open: (repository: NextTaskRepository) => Promise<string>,
) {
  const page = await attachTaskNotes(replica, client, { accountId });
  await page.repository.initialize();
  const id = await open(page.repository);
  const view = render(
    <RepositoryProvider
      mutationJournal={new MemoryMutationJournal()}
      repository={page.repository}
    >
      <TaskScreen id={id} onBack={vi.fn()} onMaterialized={vi.fn()} />
    </RepositoryProvider>,
  );
  /** The page goes away now, whatever is still in flight. */
  const unload = () => {
    window.dispatchEvent(new Event("pagehide"));
    view.unmount();
    page.repository.dispose();
    client.close();
  };
  return { ...page, id, unload };
}

const reconnect = (replica: Parameters<typeof attachTaskNotes>[0]) =>
  connect({
    connector: replica.connector(),
    app: { name: "tasknotes-test", version: "test" },
    reconnect: false,
  });

async function titleField() {
  return screen.findByLabelText("Task title", { exact: true });
}

describe("TaskScreen across an immediate reload", () => {
  beforeEach(() => localStorage.clear());

  it("keeps a title committed with Tab and reloaded straight away for review", async () => {
    const mdbase = await createTestMdbase();
    const replica = mdbase.fixture.replica();
    const first = await openPage(
      replica,
      mdbase.fixture.client(),
      async (r) => (await r.create({ title: "[test] original title" })).id,
    );
    const title = await titleField();
    fireEvent.change(title, { target: { value: "[test] replaced title" } });
    fireEvent.blur(title); // Tab
    first.unload();

    const second = await openPage(
      replica,
      await reconnect(replica),
      async () => first.id,
    );
    expect(
      await screen.findByText(
        "Unsaved edits from an earlier session are available.",
      ),
    ).toBeVisible();
    // Nothing is applied until the person chooses.
    expect(await titleField()).toHaveValue("[test] original title");

    fireEvent.click(
      screen.getByRole("button", { name: "Restore unsaved edits" }),
    );
    expect(await titleField()).toHaveValue("[test] replaced title");
    await waitFor(
      async () =>
        expect((await second.repository.get(first.id))?.title).toBe(
          "[test] replaced title",
        ),
      { timeout: 3_000 },
    );
    second.unload();

    // Once mdbase holds the save, the next open shows it and offers nothing.
    await openPage(replica, await reconnect(replica), async () => first.id);
    expect(await titleField()).toHaveValue("[test] replaced title");
    expect(
      screen.queryByText(
        "Unsaved edits from an earlier session are available.",
      ),
    ).not.toBeInTheDocument();
  });

  it("keeps typing still waiting for autosave when the page closes", async () => {
    const mdbase = await createTestMdbase();
    const replica = mdbase.fixture.replica();
    const first = await openPage(
      replica,
      mdbase.fixture.client(),
      async (r) => (await r.create({ title: "[test] original title" })).id,
    );
    fireEvent.change(await titleField(), {
      target: { value: "[test] typed, not committed" },
    });
    first.unload();

    await openPage(replica, await reconnect(replica), async () => first.id);
    fireEvent.click(
      await screen.findByRole("button", { name: "Restore unsaved edits" }),
    );
    expect(await titleField()).toHaveValue("[test] typed, not committed");
  });
});
