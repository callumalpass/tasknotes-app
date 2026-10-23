import "fake-indexeddb/auto";

import {
  connect,
  type MdbaseClient,
  type WriteLedgerEntry,
  type WriteLedgerStore,
} from "@mdbase-dev/sdk";
import { createTestMdbase } from "@mdbase-dev/sdk/testing";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { MemoryMutationJournal } from "../test/memory-mutation-journal";
import { attachTaskNotes } from "../test/next-task-fixture";
import { RepositoryProvider, useRepository } from "./repository-context";
import { TaskScreen } from "./task-screen";
import { taskEditScope, writeTaskEdit } from "./task-edit-recovery";

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
    // This case exercises an interrupted save, not a race with a save that
    // legitimately finishes before unload on a faster CI runner.
    let rejectSave!: (error: Error) => void;
    const pendingSave = new Promise<never>((_, reject) => {
      rejectSave = reject;
    });
    const save = vi
      .spyOn(first.repository, "update")
      .mockReturnValue(pendingSave);
    fireEvent.change(title, { target: { value: "[test] replaced title" } });
    fireEvent.blur(title); // Tab
    await waitFor(() => expect(save).toHaveBeenCalled());
    first.unload();
    await act(async () => rejectSave(new Error("Page closed during save")));

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

  it("keeps the recovered backup across another reload without choosing", async () => {
    const mdbase = await createTestMdbase();
    const replica = mdbase.fixture.replica();
    const setup = await openPage(
      replica,
      mdbase.fixture.client(),
      async (r) => (await r.create({ title: "[test] original title" })).id,
    );
    await titleField();
    const scope = taskEditScope(await setup.repository.collectionInfo());
    setup.unload();
    // Seed a valid prior-session copy, isolating mount effects from whether
    // a previous asynchronous save happened to complete before page close.
    expect(
      writeTaskEdit(scope, setup.id, { title: "[test] waiting for my choice" }),
    ).toBe(true);

    const first = await openPage(
      replica,
      await reconnect(replica),
      async () => setup.id,
    );
    expect(
      await screen.findByRole("button", { name: "Restore unsaved edits" }),
    ).toBeVisible();
    expect(await titleField()).toHaveValue("[test] original title");
    expect((await first.repository.get(setup.id))?.title).toBe(
      "[test] original title",
    );
    // No Restore or Discard: simply close and open the page again.
    first.unload();

    const second = await openPage(
      replica,
      await reconnect(replica),
      async () => setup.id,
    );
    const restore = await screen.findByRole("button", {
      name: "Restore unsaved edits",
    });
    expect(restore).toBeVisible();
    expect(await titleField()).toHaveValue("[test] original title");
    expect((await second.repository.get(setup.id))?.title).toBe(
      "[test] original title",
    );
    fireEvent.click(restore);
    expect(await titleField()).toHaveValue("[test] waiting for my choice");
    await waitFor(
      async () =>
        expect((await second.repository.get(setup.id))?.title).toBe(
          "[test] waiting for my choice",
        ),
      { timeout: 3_000 },
    );
    second.unload();
  });

  it.each(["available", "unavailable"] as const)(
    "waits for the recovery scope before exposing title editing (%s)",
    async (outcome) => {
      const mdbase = await createTestMdbase();
      const client = mdbase.fixture.client();
      const page = await attachTaskNotes(mdbase.fixture.replica(), client, {
        accountId,
      });
      await page.repository.initialize();
      const task = await page.repository.create({
        title: "[test] original title",
      });
      const journal = new MemoryMutationJournal();
      function Ready() {
        const { status } = useRepository();
        return <p>{status === "ready" ? "Repository ready" : "Opening"}</p>;
      }
      const view = render(
        <RepositoryProvider
          mutationJournal={journal}
          repository={page.repository}
        >
          <Ready />
        </RepositoryProvider>,
      );
      let releaseInfo: () => void = () => undefined;
      let rejectInfo: (error: Error) => void = () => undefined;
      try {
        // Arm the delay AFTER provider startup: otherwise its own metadata
        // request blocks the entire screen and produces a false-positive guard.
        await screen.findByText("Repository ready");
        const info = await page.repository.collectionInfo();
        const pending = new Promise<typeof info>((resolve, reject) => {
          releaseInfo = () => resolve(info);
          rejectInfo = reject;
        });
        const scope = vi
          .spyOn(page.repository, "collectionInfo")
          .mockReturnValue(pending);
        const get = vi.spyOn(page.repository, "get").mockResolvedValue(task);
        await act(async () => {
          view.rerender(
            <RepositoryProvider
              mutationJournal={journal}
              repository={page.repository}
            >
              <TaskScreen
                id={task.id}
                onBack={vi.fn()}
                onMaterialized={vi.fn()}
              />
            </RepositoryProvider>,
          );
        });
        expect(get).toHaveBeenCalledWith(task.id);
        expect(scope).toHaveBeenCalled();
        expect(
          screen.queryByLabelText("Task title", { exact: true }),
        ).not.toBeInTheDocument();
        if (outcome === "unavailable") {
          await act(async () =>
            rejectInfo(new Error("Recovery identity unavailable")),
          );
          const notice = screen.getByRole("alert");
          expect(notice).toBeVisible();
          expect(notice).toHaveTextContent("Unsaved edit recovery");
          expect(notice).toHaveTextContent(
            "Go back and refresh the collection before editing.",
          );
          // Raw details are deliberately collapsed by OperationErrorNotice.
          expect(
            screen.getByText("Recovery identity unavailable"),
          ).not.toBeVisible();
          expect(
            screen.queryByLabelText("Task title", { exact: true }),
          ).not.toBeInTheDocument();
          expect(screen.getByRole("button", { name: "Back" })).toBeEnabled();
          return;
        }
        await act(async () => releaseInfo());
        expect(await titleField()).toHaveValue("[test] original title");
      } finally {
        await act(async () => {
          releaseInfo();
          view.unmount();
        });
        page.repository.dispose();
        client.close();
      }
    },
  );

  it.each([false, true])(
    "keeps an offline notes edit refused by a newer change elsewhere, and that change (optimistic reopen: %s)",
    async (optimisticReopen) => {
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
      const capture = vi.spyOn(first.repository, "update");
      replica.stallConfirmations();
      fireEvent.change(await screen.findByLabelText("Notes"), {
        target: { value: "My offline notes" },
      });
      await waitFor(() => expect(update).toHaveBeenCalledOnce(), {
        timeout: 3_000,
      });
      await waitFor(() => expect(capture).toHaveBeenCalledOnce());
      await act(async () => {
        await capture.mock.results[0]!.value;
      });
      const path = (await first.repository.get(first.id))!.path;
      const hasBodyBackup = (body = "My offline notes") =>
        Object.values(localStorage).some((value) =>
          value.includes(`"body":${JSON.stringify(body)}`),
        );
      expect(hasBodyBackup()).toBe(true);
      expect(first.repository.writeState({ kind: "task", id: first.id })).toBe(
        "pending",
      );
      first.unload();

      if (optimisticReopen) {
        // A reload may read the device's optimistic value before head refuses it.
        // Seeing that value is NOT confirmation that the backup can be removed.
        const optimistic = await openPage(
          replica,
          await device(),
          async () => first.id,
        );
        try {
          await titleField();
          expect((await optimistic.repository.get(first.id))?.body.trim()).toBe(
            "My offline notes",
          );
          expect(
            optimistic.repository.writeState({ kind: "task", id: first.id }),
          ).toBe("pending");
          expect(hasBodyBackup()).toBe(true);
        } finally {
          optimistic.unload();
        }
      }

      // Another app moves the date; the log refuses the stale offline write.
      replica.reject(update.mock.calls[0]![2]!.mutationId!);
      replica.editElsewhere(path, { frontmatter: { scheduled: "2026-10-16" } });
      replica.stallConfirmations(false);

      let second = await openPage(
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
      if (optimisticReopen) {
        // Restoring a refused draft must also survive closing without a choice.
        second.unload();
        second = await openPage(replica, await device(), async () => first.id);
        await screen.findByText(
          "This task changed somewhere else, so your edit wasn't saved.",
        );
        await waitFor(() =>
          expect(screen.getByLabelText("Notes")).toHaveValue(
            "My offline notes",
          ),
        );
        expect(hasBodyBackup()).toBe(true);
      }
      const expectedBody = optimisticReopen
        ? "My revised offline notes"
        : "My offline notes";
      if (optimisticReopen) {
        fireEvent.change(screen.getByLabelText("Notes"), {
          target: { value: expectedBody },
        });
        const notified = vi.fn();
        const stop = second.repository.subscribe(notified);
        try {
          await act(async () => {
            replica.editElsewhere(first.id, {
              frontmatter: { scheduled: "2026-10-17" },
            });
          });
          await waitFor(() => expect(notified).toHaveBeenCalled());
          expect(screen.getByLabelText("Notes")).toHaveValue(expectedBody);
          expect(hasBodyBackup(expectedBody)).toBe(true);
        } finally {
          stop();
        }
      }
      fireEvent.click(screen.getByRole("button", { name: "Keep my edit" }));
      await waitFor(
        async () => {
          replica.confirmAll();
          const saved = await second.repository.get(first.id);
          expect(saved?.body.trim()).toBe(expectedBody);
          expect(saved?.scheduled).toBe(
            optimisticReopen ? "2026-10-17" : "2026-10-16",
          );
        },
        { timeout: 3_000 },
      );
      await waitFor(() => expect(hasBodyBackup(expectedBody)).toBe(false));
      second.unload();
    },
  );
});
