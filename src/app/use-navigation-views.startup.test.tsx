import { render, screen } from "../test/render";
import { expect, it } from "vitest";

import { taskRepositoryStub } from "../test/task-repository-stub";
import { MemoryMutationJournal } from "../test/memory-mutation-journal";
import {
  registerStartupTiming,
  startupTiming,
} from "../observability/startup-timing";
import { RepositoryProvider } from "./repository-context";
import { useNavigationViews } from "./use-navigation-views";

import type { TaskRepository } from "../application/ports/task-repository";
import type { TaskViewDocument } from "../domain/view";

const documents: TaskViewDocument[] = [
  {
    id: "views",
    name: "views.base",
    source: {
      path: "views.base",
      revision: "r1",
      format: "obsidian.base",
      writable: false,
    },
    views: [
      {
        key: "views.base#today",
        documentId: "views",
        documentName: "views.base",
        id: "today",
        name: "Today",
        properties: [],
        source: {
          path: "views.base",
          revision: "r1",
          format: "obsidian.base",
          writable: false,
        },
      },
    ],
  },
];

function stub(listViews: TaskRepository["listViews"]) {
  return taskRepositoryStub({
    collectionInfo: async () => ({
      kind: "connect" as const,
      id: "next:account:collection",
      collectionId: "collection",
      name: "Tasks",
      location: "Tasks",
      runtime: "browser" as const,
    }),
    cachedViews: async () => [],
    listViews,
  });
}

function Probe() {
  const { views, error } = useNavigationViews();
  if (error) return <p>{error}</p>;
  return <p>{views ? `${views.length} views` : "loading"}</p>;
}

function show(repository: TaskRepository) {
  render(
    <RepositoryProvider
      repository={repository}
      mutationJournal={new MemoryMutationJournal()}
    >
      <Probe />
    </RepositoryProvider>,
  );
}

it("measures the start's first published view discovery", async () => {
  const repository = stub(async () => documents);
  registerStartupTiming(repository);
  show(repository);
  await screen.findByText("1 views");
  expect(startupTiming(repository)!.has("view_discovery")).toBe(true);
});

it("does not measure a failed discovery, which still offers its error", async () => {
  const repository = stub(async () => {
    throw new Error("Discovery failed");
  });
  registerStartupTiming(repository);
  show(repository);
  await screen.findByText("Couldn't load your views.");
  expect(startupTiming(repository)!.has("view_discovery")).toBe(false);
});
