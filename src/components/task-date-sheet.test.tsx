import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "../test/render";
import { RepositoryProvider } from "../app/repository-context";
import { MemoryMutationJournal } from "../test/memory-mutation-journal";
import { nextTaskFixture } from "../test/next-task-fixture";
import { TaskDetailDates } from "./task-detail-dates";

afterEach(() => vi.unstubAllGlobals());

it("anchors the phone date sheet across the viewport and returns focus without editing", async () => {
  const { repository } = await nextTaskFixture();
  await repository.initialize();
  vi.stubGlobal("innerWidth", 412);
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const onChange = vi.fn();
  render(
    <RepositoryProvider
      repository={repository}
      mutationJournal={new MemoryMutationJournal()}
    >
      <TaskDetailDates
        draft={{ scheduled: "2026-11-05" }}
        onChange={onChange}
      />
    </RepositoryProvider>,
  );
  const trigger = screen.getByRole("button", { name: "Scheduled date" });
  fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog", {
    name: "Scheduled date calendar",
  });
  expect(dialog.style.width).toBe("412px");
  expect(dialog.style.left).toBe("0px");
  expect(dialog.style.top).toBe("auto");
  expect(dialog.style.bottom).toBe("0px");
  fireEvent.click(within(dialog).getByRole("button", { name: "Close dates" }));
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(onChange).not.toHaveBeenCalled();
});
