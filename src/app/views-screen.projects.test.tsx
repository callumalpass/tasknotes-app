import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { DemoTaskRepository } from "../demo/demo-task-repository";
import { MemoryMutationJournal } from "../test/memory-mutation-journal";
import { RepositoryProvider } from "./repository-context";
import { ViewsScreen } from "./views-screen";

it("loads identity tasks for Projects when the repository honors limit zero", async () => {
  const repository = new DemoTaskRepository(2);
  const list = vi.spyOn(repository, "listSummaries");
  const documents = await repository.listViews();
  const views = documents.flatMap((document) => document.views);
  const view = views.find(
    (candidate) => candidate.presentation?.type === "tasknotes.projects",
  )!;
  render(
    <RepositoryProvider
      repository={repository}
      mutationJournal={new MemoryMutationJournal()}
    >
      <ViewsScreen
        documents={documents}
        views={views}
        navigationViewKeys={[view.key]}
        operational
        viewKey={view.key}
        onBack={() => undefined}
        onOpenTask={() => undefined}
        onOpenView={() => undefined}
        onSearch={() => undefined}
        onMoveNavigationView={() => undefined}
        onToggleNavigationView={() => undefined}
        onViewsChanged={async () => undefined}
      />
    </RepositoryProvider>,
  );
  expect(
    await screen.findByRole("button", { name: "Add task to Field research" }),
  ).toBeVisible();
  expect(list).toHaveBeenCalledWith(
    expect.objectContaining({ status: "all", limit: 50_000 }),
  );
});
