import { mdbaseError } from "@mdbase-dev/sdk";
import { render, screen } from "../test/render";
import { it } from "vitest";

import { taskRepositoryStub } from "../test/task-repository-stub";
import { MemoryMutationJournal } from "../test/memory-mutation-journal";
import { RepositoryProvider } from "./repository-context";
import { useNavigationViews } from "./use-navigation-views";

import type { TaskRepository } from "../application/ports/task-repository";
import type { TaskViewDocument } from "../domain/view";

const source = {
  path: "TaskNotes/Views/tasks-default.base",
  revision: "r1",
  format: "obsidian.base",
  writable: true,
} as const;
const unreadable: TaskViewDocument = {
  id: "broken",
  name: source.path,
  source,
  views: [],
  unreadable: {
    reason: "view_metadata_unavailable",
    detail: "base_raw_frontmatter_unavailable",
  },
};

function show(listViews: TaskRepository["listViews"]) {
  const repository = taskRepositoryStub({
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
  render(
    <RepositoryProvider
      repository={repository}
      mutationJournal={new MemoryMutationJournal()}
    >
      <Probe />
    </RepositoryProvider>,
  );
}

function Probe() {
  const { discovery, discoveryFailure, unreadableViewFiles } =
    useNavigationViews();
  return (
    <p>
      {discovery}/{discoveryFailure ?? "none"}/
      {unreadableViewFiles
        .map(({ path, reason, detail }) => [path, reason, detail].join("|"))
        .join(",") || "nothing"}
    </p>
  );
}

it("lists the paths of view files discovery could not read", async () => {
  show(async () => [unreadable]);
  await screen.findByText(
    `empty/none/${source.path}|view_metadata_unavailable|base_raw_frontmatter_unavailable`,
  );
});

it("tells an unreadable view file from other failures when discovery is refused", async () => {
  show(async () => {
    throw mdbaseError(
      "invalid_request",
      "base raw frontmatter unavailable",
      "view_metadata_unavailable",
    );
  });
  await screen.findByText("error/unreadable_source/nothing");
});

it("classifies any other refusal as other", async () => {
  show(async () => {
    throw mdbaseError("unavailable", "offline", "disconnected");
  });
  await screen.findByText("error/other/nothing");
});
