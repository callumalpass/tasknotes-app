import { act, render, screen } from "../test/render";
import { expect, it } from "vitest";
import { nextTaskFixture, seedRecord } from "../test/next-task-fixture";
import { MemoryMutationJournal } from "../test/memory-mutation-journal";
import { taskNotesDefaultBaseSources } from "../domain/default-view-source";
import type { TaskView } from "../domain/view";
import { Navigation } from "./app-shell";
import { RepositoryProvider } from "./repository-context";
import { useNavigationTaskCounts } from "./use-navigation-task-counts";

function InboxNavigation({ view }: { view: TaskView }) {
  const counts = useNavigationTaskCounts([view]);
  return (
    <Navigation
      active={`view:${view.key}`}
      mode="desktop"
      navigationKeys={[view.key]}
      views={[view]}
      navigationCounts={counts}
      onNavigate={() => undefined}
    />
  );
}

it.each([0, 3])(
  "counts the %i saved Inbox rows among 40 id-less CLI tasks",
  async (matches) => {
    const f = await nextTaskFixture();
    try {
      const configuration = await f.repository.taskConfiguration();
      const inbox = taskNotesDefaultBaseSources(configuration).find(
        (source) => source.name === "Inbox",
      )!;
      expect(inbox.document).toContain('file.hasTag("task")');
      // MemoryReplica selects rows by type. Supply the starter Base's selected
      // subset explicitly while every record is still in the real task index.
      const source = f.replica.seedBaseView({
        path: inbox.path,
        name: inbox.name,
        types: ["inbox-member"],
        columns: ["file.path", "title"],
      });
      f.replica.editElsewhere(source.record, { body: inbox.document });
      for (let index = 0; index < 40; index++) {
        const tagged = index < matches;
        seedRecord(f.replica, {
          path: `tasks/task-${index}.md`,
          types: tagged ? ["task", "inbox-member"] : ["task"],
          frontmatter: {
            type: "task",
            title: `Seed Task ${index}`,
            status: "open",
            priority: "normal",
            ...(tagged ? { tags: ["task"] } : {}),
          },
        });
      }
      expect(await f.repository.stats()).toMatchObject({ total: 40 });
      const [document] = await f.repository.listViews();
      const view = document!.views[0]!;
      render(
        <RepositoryProvider
          repository={f.repository}
          mutationJournal={new MemoryMutationJournal()}
        >
          <InboxNavigation view={view} />
        </RepositoryProvider>,
      );
      expect(
        await screen.findByRole("button", { name: "Inbox" }),
      ).toBeVisible();
      await act(async () => {
        const result = await f.repository.executeView(view);
        expect(result.rows).toHaveLength(matches);
        expect(result.rows.every(({ task }) => task.id === task.path)).toBe(
          true,
        );
      });
      expect(
        await screen.findByRole("button", { name: `Inbox ${matches}` }),
      ).toBeVisible();
      expect(
        f.repository.cachedInboxCount({
          ...view,
          source: { ...view.source, revision: "edited" },
        }),
      ).toBeNull();
      await act(async () => {
        await f.repository.create({ title: "Invalidate the saved result" });
      });
      expect(
        await screen.findByRole("button", { name: "Inbox" }),
      ).toBeVisible();
    } finally {
      f.close();
    }
  },
);
