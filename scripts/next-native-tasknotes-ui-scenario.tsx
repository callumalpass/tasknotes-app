/** LOCAL TEST: actual TaskScreen/RepositoryProvider and application journal,
 * using the existing actual native-backed repository. Never creates a badge. */
import { createRoot } from "react-dom/client";
import { RepositoryProvider } from "../src/app/repository-context";
import { TaskScreen } from "../src/app/task-screen";
import { IndexedDbMutationJournal } from "../src/storage/application-journal";
import type { NextTaskRepository } from "../src/storage/next-repository";
import type { MdbaseClient } from "@mdbase-dev/sdk";
const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
const check: (value: unknown, message: string) => asserts value = (
  value,
  message,
) => {
  if (!value) throw Error(`owned native TaskNotes UI: ${message}`);
};
export const UI_TITLE = "Native UI saved";
export async function qualifyNativeTaskNotesUi(options: {
  repository: NextTaskRepository;
  client: MdbaseClient;
  taskId: string;
  fresh: boolean;
  submitted: string[];
  drive(): Promise<void>;
}) {
  const { repository, client, taskId, fresh, submitted, drive } = options;
  const container = document.createElement("div");
  document.body.append(container);
  const journal = new IndexedDbMutationJournal("owned-native-tasknotes-ui");
  let renderError: unknown;
  const root = createRoot(container, {
    onUncaughtError: (error) => {
      renderError = error;
    },
  });
  root.render(
    <RepositoryProvider repository={repository} mutationJournal={journal}>
      <TaskScreen id={taskId} onBack={() => {}} onMaterialized={() => {}} />
    </RepositoryProvider>,
  );
  async function until(predicate: () => boolean, reason: string, pump = false) {
    for (let round = 0; round < 100; round++) {
      if (renderError) throw renderError;
      if (predicate()) return;
      if (pump) await drive();
      await pause(50);
    }
    throw Error(
      `owned native TaskNotes UI: ${reason}; ${container.textContent?.slice(0, 400)}`,
    );
  }
  const badge = () =>
    container.querySelector<HTMLButtonElement>("button.save-state");
  let keepMounted = false;
  const dispose = () => {
    root.unmount();
    journal.close();
    container.remove();
  };
  try {
    await until(
      () => Boolean(container.querySelector("#task-title")),
      "real task editor did not initialize",
    );
    if (fresh) {
      const before = submitted.length;
      const field =
        container.querySelector<HTMLTextAreaElement>("#task-title")!;
      const set = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      set.call(field, UI_TITLE);
      field.dispatchEvent(new Event("input", { bubbles: true }));
      await pause(40);
      check(
        badge()?.textContent?.trim() !== "Saved",
        "Saved shown for a dirty unconfirmed draft",
      );
      await until(
        () => submitted.length > before,
        "UI autosave did not submit its original mutation",
      );
      check(submitted.length === before + 1, "UI edit was resubmitted");
      const original = submitted[before]!;
      check(
        (await client.receipt(original, AbortSignal.timeout(5000))).state ===
          "pending",
        "UI confirmation-blocking window not exercised",
      );
      check(
        badge()?.textContent?.trim() === "Saving",
        "UI lacks pending feedback",
      );
      await until(
        () => badge()?.textContent?.trim() === "Saved",
        "UI never displayed Saved after real log drive",
        true,
      );
      check(
        (await client.receipt(original, AbortSignal.timeout(5000))).state ===
          "confirmed",
        "UI Saved before original confirmation",
      );
      check(
        submitted.length === before + 1,
        "UI confirmed via another mutation",
      );
    }
    const task = await repository.get(taskId);
    check(
      task?.id === taskId && task.title === UI_TITLE,
      "actual UI task differs from original native task",
    );
    const field = container.querySelector<HTMLTextAreaElement>("#task-title");
    check(
      field?.value === UI_TITLE && badge()?.textContent?.trim() === "Saved",
      "restored UI does not show original confirmed task",
    );
    keepMounted = true;
    return {
      summary: {
        actualTaskScreen: true,
        actualRepositoryProvider: true,
        actualApplicationJournal: true,
        uiSavedBadgeQualified: true,
      },
      dispose,
    };
  } finally {
    if (!keepMounted) dispose();
  }
}
