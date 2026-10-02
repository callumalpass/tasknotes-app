import { StrictMode, useEffect, useState } from "react";
import { act, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { RepositoryProvider, useRepository } from "./repository-context";
import { MdbaseTaskRepository } from "../storage/mdbase-repository";
import { ViewQuerySession } from "../application/view-query-session";
import { deferred, mdbaseFixture, taskRecord } from "../test/mdbase-fixture";
import { MemoryMutationJournal } from "../test/memory-mutation-journal";

it("reopens through Try again and initializes command services after a describe failure", async () => {
  const fixture = mdbaseFixture([
    taskRecord("one", "First visible task", "r1"),
  ]);
  fixture.describe.mockRejectedValueOnce(new TypeError("Offline at opening"));
  const repository = new MdbaseTaskRepository(fixture.connect);
  let context!: ReturnType<typeof useRepository>;
  function Probe() {
    const value = useRepository();
    useEffect(() => {
      context = value;
    }, [value]);
    return <p>{value.status}</p>;
  }
  render(
    <RepositoryProvider
      repository={repository}
      mutationJournal={new MemoryMutationJournal()}
    >
      <Probe />
    </RepositoryProvider>,
  );
  await screen.findByText("error");
  await act(async () => {
    await context.refresh();
  });
  expect(context.status).toBe("ready");
  expect(context.error).toBeNull();
  await act(async () => {
    await context.deleteTask("one");
  });
  expect(context.pendingDeletion?.id).toBe("one");
  await act(async () => {
    await context.undoTaskDeletion();
  });
});

it("retries command-journal initialization rather than announcing partial readiness", async () => {
  const repository = new MdbaseTaskRepository(
    mdbaseFixture([taskRecord("one", "One", "r1")]).connect,
  );
  const journal = new MemoryMutationJournal();
  const list = vi
    .spyOn(journal, "list")
    .mockRejectedValueOnce(new Error("Journal failed"));
  let context!: ReturnType<typeof useRepository>;
  function Probe() {
    const value = useRepository();
    useEffect(() => {
      context = value;
    }, [value]);
    return <p>{value.status}</p>;
  }
  render(
    <RepositoryProvider repository={repository} mutationJournal={journal}>
      <Probe />
    </RepositoryProvider>,
  );
  await screen.findByText("error");
  await act(async () => {
    await context.refresh();
  });
  expect(context.status).toBe("ready");
  expect(list).toHaveBeenCalledTimes(2);
  await act(async () => {
    await context.deleteTask("one");
  });
  expect(context.pendingDeletion?.id).toBe("one");
  await act(async () => {
    await context.undoTaskDeletion();
  });
});

it("reopens after backgrounding during describe and ignores the old opening failure", async () => {
  const fixture = mdbaseFixture([
    taskRecord("one", "First visible task", "r1"),
  ]);
  const started = deferred<void>();
  const release = deferred<void>();
  fixture.describe.mockImplementationOnce(async () => {
    started.resolve();
    await release.promise;
    throw new TypeError("Old opening failed");
  });
  const repository = new MdbaseTaskRepository(fixture.connect);
  render(
    <RepositoryProvider
      repository={repository}
      mutationJournal={new MemoryMutationJournal()}
    >
      <FirstView />
    </RepositoryProvider>,
  );
  await act(async () => {
    await started.promise;
  });
  const visibility = vi.spyOn(document, "visibilityState", "get");
  try {
    visibility.mockReturnValue("hidden");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    visibility.mockReturnValue("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(await screen.findByText("First visible task")).toBeVisible();
    await act(async () => {
      release.resolve();
    });
    expect(screen.getByText("ready")).toBeVisible();
    expect(screen.queryByText("error")).toBeNull();
  } finally {
    visibility.mockRestore();
    release.resolve();
  }
});

it("opens under StrictMode replay", async () => {
  const repository = new MdbaseTaskRepository(
    mdbaseFixture([taskRecord("one", "First visible task", "r1")]).connect,
  );
  render(
    <StrictMode>
      <RepositoryProvider
        repository={repository}
        mutationJournal={new MemoryMutationJournal()}
      >
        <FirstView />
      </RepositoryProvider>
    </StrictMode>,
  );
  expect(await screen.findByText("First visible task")).toBeVisible();
  expect(screen.getByText("ready")).toBeVisible();
});

it("shows a usable first view while enabled archive reconciliation and the metadata scan are blocked", async () => {
  const fixture = mdbaseFixture([
    taskRecord("one", "First visible task", "r1"),
  ]);
  const repository = new MdbaseTaskRepository(fixture.connect);
  const configuration = await repository.taskConfiguration();
  configuration.statuses = configuration.statuses.map((status) => ({
    ...status,
    autoArchive: status.value === "done",
    autoArchiveDelay: 5,
  }));
  vi.spyOn(repository, "taskConfiguration").mockResolvedValue(configuration);
  const original = fixture.queryPages.getMockImplementation()!;
  const release = deferred<void>();
  fixture.queryPages.mockImplementation((input, options) =>
    (async function* () {
      await release.promise;
      yield* original(input, options);
    })(),
  );
  const rendered = render(
    <RepositoryProvider
      repository={repository}
      mutationJournal={new MemoryMutationJournal()}
    >
      <FirstView />
    </RepositoryProvider>,
  );
  try {
    expect(await screen.findByText("First visible task")).toBeVisible();
    expect(screen.getByText("ready")).toBeVisible();
    expect(fixture.queryPages).toHaveBeenCalledOnce();
    expect(fixture.executeViewPages).toHaveBeenCalledOnce();
  } finally {
    await act(async () => {
      release.resolve();
      await repository.stats();
    });
    rendered.unmount();
  }
});

function FirstView() {
  const { repository, status } = useRepository();
  const [title, setTitle] = useState("");
  useEffect(() => {
    if (status !== "ready") return;
    let active = true;
    let session: ViewQuerySession | undefined;
    void repository.listViews().then(([document]) => {
      if (!active) return;
      session = new ViewQuerySession(
        repository,
        {
          ...document.views[0],
          presentation: {
            type: "tasknotes.task-list",
            options: {},
            mappings: {},
          },
        },
        {
          result: (result) => setTitle(result.rows[0]?.task.title ?? "Empty"),
          error: (reason) => setTitle(String(reason)),
          pending: () => {},
        },
      );
      return session.start();
    });
    return () => {
      active = false;
      session?.close();
    };
  }, [repository, status]);
  return (
    <>
      <p>{status}</p>
      <p>{title}</p>
    </>
  );
}
