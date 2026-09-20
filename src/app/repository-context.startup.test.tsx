import { useEffect, useState } from "react";
import { act, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { RepositoryProvider, useRepository } from "./repository-context";
import { MdbaseTaskRepository } from "../storage/mdbase-repository";
import { ViewQuerySession } from "../application/view-query-session";
import { deferred, mdbaseFixture, taskRecord } from "../test/mdbase-fixture";
import { MemoryMutationJournal } from "../test/memory-mutation-journal";

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
