import { test, expect } from "./local-test";
import { openFixture } from "./next-fixture";
import { parseFrontmatter } from "@tasknotes/model/frontmatter";
import { loadCanonicalTaskNotesTypePack } from "../scripts/canonical-task-pack.mjs";

// Same task fields/variation as mdbase-prod-testing/seed/r3-6c-tasks.py.
// This isolates the TaskNotes read/render path after SDK admission, not native sync.
for (const count of [500, 1000]) {
  test(`opens ${count} seeded tasks`, async ({ page }, info) => {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const records = Array.from({ length: count }, (_, index) => {
      const date = new Date(`${today}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + (index % 31) - 15);
      return {
        path: `tasks/r3-6c-${String(index).padStart(3, "0")}.md`,
        frontmatter: {
          title: `[test] scale task ${String(index).padStart(3, "0")}`,
          status: ["open", "in-progress", "done", "cancelled"][index % 4],
          priority: ["none", "low", "normal", "high"][index % 4],
          scheduled: date.toISOString().slice(0, 10),
          due: date.toISOString().slice(0, 10),
          dateCreated: now.toISOString(),
          dateModified: now.toISOString(),
          ...(index % 4 === 2 ? { completedDate: today } : {}),
          tags: ["task", "test", `group${index % 5}`],
          projects: [`[test] scale project ${index % 4}`],
          id: crypto.randomUUID(),
          mobileRevision: 1,
          type: "task",
        },
        body: "",
      };
    });
    const started = Date.now();
    const pack = await loadCanonicalTaskNotesTypePack();
    const task = pack.resources.find((resource: { source: string }) =>
      resource.source.startsWith("types/tasknotes-task/"),
    );
    await openFixture(page, {
      records,
      typeDefinition: parseFrontmatter(task!.document).frontmatter,
    });
    await expect(
      page.getByRole("heading", { name: "Today", exact: true }),
    ).toBeVisible();
    const openedMs = Date.now() - started;
    await expect(
      page.getByRole("button", { name: "[test] scale task 000", exact: true }),
    ).toBeVisible();
    const firstRowsMs = Date.now() - started;
    await info.attach("scale-timings", {
      body: JSON.stringify({
        count,
        openedMs,
        firstRowsMs,
        scope: "local SDK protocol fixture; native admission excluded",
      }),
      contentType: "application/json",
    });
  });
}
