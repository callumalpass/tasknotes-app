import "fake-indexeddb/auto";

import {
  connect,
  type MdbaseClient,
  type WriteLedgerEntry,
  type WriteLedgerStore,
} from "@mdbase-dev/sdk";
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

  it("keeps an offline notes edit refused by a newer change elsewhere, and that change", async () => {
    // The device keeps its replica and its write ledger across the reload.
    const rows = new Map<string, WriteLedgerEntry>();
    const ledger: WriteLedgerStore = {
      list: async () => [...rows.values()],
      put: async (entry) => void rows.set(entry.mutationId, entry),
      remove: async (id) => void rows.delete(id),
    };
    const mdbase = await createTestMdbase();
    const replica = mdbase.fixture.replica();
    const device = () =>
      connect({
        connector: replica.connector(),
        app: { name: "tasknotes-test", version: "test" },
        reconnect: false,
        ledger,
      });
    const firstClient = await device();
    const update = vi.spyOn(firstClient, "update");
    const first = await openPage(replica, firstClient, async (r) => {
      const task = await r.create({
        title: "[test] shared task",
        scheduled: "2026-10-15",
      });
      replica.confirmAll();
      return task.id;
    });
    // Offline: the save is captured on this device and waits for sync.
    replica.stallConfirmations();
    fireEvent.change(await screen.findByLabelText("Notes"), {
      target: { value: "My offline notes" },
    });
    await waitFor(() => expect(update).toHaveBeenCalledOnce(), {
      timeout: 3_000,
    });
    const path = (await first.repository.get(first.id))!.path;
    await new Promise((resolve) => setTimeout(resolve, 50));
    first.unload();

    // Another app moves the date; the log refuses the stale offline write.
    replica.reject(update.mock.calls[0]![2]!.mutationId!);
    replica.editElsewhere(path, { frontmatter: { scheduled: "2026-10-16" } });
    replica.stallConfirmations(false);

    const second = await openPage(
      replica,
      await device(),
      async () => first.id,
    );
    expect(
      await screen.findByText(
        "This task changed somewhere else, so your edit wasn't saved.",
      ),
    ).toBeVisible();
    await waitFor(() =>
      expect(screen.getByLabelText("Notes")).toHaveValue("My offline notes"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Keep my edit" }));
    await waitFor(
      async () => {
        replica.confirmAll();
        const saved = await second.repository.get(first.id);
        expect(saved?.body.trim()).toBe("My offline notes");
        expect(saved?.scheduled).toBe("2026-10-16");
      },
      { timeout: 3_000 },
    );
  });
});
