import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { buildTaskNotesMdbaseResources } from "@tasknotes/model/mdbase";
import type { PlainValue } from "@mdbase-dev/sdk";
import { expect, test, type Page } from "./local-test";
import { TaskNotesTaskModel } from "../src/domain/tasknotes-model";
import type { NextSmokeInput } from "../src/test/next-entry-smoke-fixture";

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    const evidence = await page.evaluate(() => {
      const c = window.__TASKNOTES_NEXT_SMOKE_CONTROL__;
      return c
        ? {
            operations: c.operations,
            errors: c.errors,
            records: c.records().map((r) => ({
              id: r.id,
              path: r.path,
              title: r.frontmatter.title,
            })),
          }
        : null;
    });
    await testInfo.attach("synthetic-sdk-diagnostics", {
      body: JSON.stringify(evidence),
      contentType: "application/json",
    });
  }
});

async function openFixture(page: Page, input: NextSmokeInput) {
  await page.addInitScript((value) => {
    window.__TASKNOTES_NEXT_SMOKE__ = value;
  }, input);
  await page.goto("./");
  await page
    .getByRole("button", { name: "Open synced fixture collection" })
    .click();
}
function taskRecord(title: string, id: string) {
  const task = new TaskNotesTaskModel().create(
    { title },
    { id, now: "2026-07-22T00:00:00.000Z" },
  );
  return {
    path: task.path,
    frontmatter: task.frontmatter as Record<string, PlainValue>,
    body: task.body,
  };
}
async function nav(page: Page, name: string) {
  const direct = page.getByRole("button", { name, exact: true });
  if (await direct.isVisible()) await direct.click();
  else {
    await page.getByRole("button", { name: "Browse", exact: true }).click();
    await page.getByRole("menuitem", { name, exact: true }).click();
  }
}
async function operations(page: Page) {
  return page.evaluate(
    () => window.__TASKNOTES_NEXT_SMOKE_CONTROL__!.operations,
  );
}

// SDK protocol stand-ins port the application behaviours formerly tested via
// classic encrypted relay routes. They are not native authorization/READ proof.
test("opens the original held client without relay traffic and preserves navigation across owner replacement", async ({
  page,
}) => {
  const outside: string[] = [];
  page.on("request", (request) => {
    if (
      page.url() !== "about:blank" &&
      new URL(request.url()).origin !== new URL(page.url()).origin
    )
      outside.push(request.url());
  });
  await openFixture(page, {
    records: [taskRecord("Task from the held client", "held-task")],
  });
  await expect(
    page.getByText("Task from the held client", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "TaskNotes could not open." }),
  ).toHaveCount(0);
  expect(await operations(page)).toEqual(
    expect.arrayContaining(["describe", "query", "bases-discovery"]),
  );
  expect(outside).toEqual([]);
  await nav(page, "Manage views");
  await expect(
    page.getByRole("heading", { name: "Manage views" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Create view", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "New view" })).toBeVisible();
  await page
    .getByRole("dialog", { name: "New view" })
    .getByRole("button", { name: "Close view editor" })
    .click();
  await page
    .getByRole("alertdialog", { name: "Discard changes?" })
    .getByRole("button", { name: "Discard changes" })
    .click();
  await expect(
    page.getByRole("button", { name: "Remove Search from navigation" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reorder", exact: true }).click();
  await page.getByRole("button", { name: "Move Search earlier" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Object.values(
            JSON.parse(
              localStorage.getItem("tasknotes:navigation-views:v4") ?? "{}",
            ),
          )[0],
      ),
    )
    .toEqual([
      "33333333-3333-4333-8333-000000000001#0",
      "33333333-3333-4333-8333-000000000002#0",
      "tasknotes:search",
      "tasknotes:scratchpad",
      "33333333-3333-4333-8333-000000000003#0",
      "33333333-3333-4333-8333-000000000004#0",
      "33333333-3333-4333-8333-000000000005#0",
    ]);
  await page
    .getByRole("button", { name: "Remove Search from navigation" })
    .click();
  await expect(
    page.getByRole("button", { name: "Add Search to navigation" }),
  ).toBeVisible();
  await nav(page, "Settings");
  await expect(
    page.getByRole("heading", { name: "Notifications" }),
  ).toBeVisible();
  await expect(page.getByText(/mdbase delivers reminders/)).toBeVisible();
  await expect(page.getByText(/Hosted collections only/)).toHaveCount(0);
  await page
    .getByRole("button", { name: "Change collection", exact: true })
    .click();
  // Native selection closes the original owner and returns to the installation
  // gate, not the removed classic saved-relay list/authorization installation.
  await expect(
    page.getByRole("heading", { name: "Open TaskNotes", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open synced fixture collection" })
    .click();
  await expect(
    page.getByRole("button", { name: "Today", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Open synced fixture collection" })
    .click();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(
    page.getByText("Task from the held client", { exact: true }),
  ).toBeVisible();
  expect(outside).toEqual([]);
});

test("reviews a held-client scratchpad selectively and collapses outline branches", async ({
  page,
}) => {
  await openFixture(page, {
    records: [
      {
        path: "scratchpads/Scratchpad.md",
        types: ["tasknotes-scratch"],
        frontmatter: {
          type: "tasknotes-scratch",
          id: "scratchpad-smoke",
          state: "active",
          dateCreated: "2026-08-06T00:00:00.000Z",
          dateModified: "2026-08-06T00:00:00.000Z",
        },
        body: "- [ ] Parent task\n  - [ ] Child task\n- [ ] Independent task\n- Context that should stay a note\n",
      },
    ],
  });
  await page.getByRole("button", { name: "Scratchpad", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Draft task: Parent task" }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: /^Draft task:/ })).toHaveCount(
    4,
  );
  await expect(page.getByRole("textbox", { name: /^Note:/ })).toHaveCount(1);
  await page
    .getByRole("button", { name: "Collapse Parent task, 1 nested item" })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Draft task: Child task" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Expand Parent task, 1 nested item" })
    .click();
  await page.getByRole("textbox", { name: "Draft task: Child task" }).focus();
  if ((page.viewportSize()?.width ?? 1000) <= 560) {
    await expect(
      page.getByRole("button", { name: "Outdent", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Child", exact: true }),
    ).toBeVisible();
  }
  await page.getByRole("button", { name: "Create task notes" }).click();
  const review = page.getByRole("dialog", { name: "Create task notes" });
  await expect(review).toContainText("3 of 3 selected");
  await page.getByRole("checkbox", { name: "Child task" }).uncheck();
  await expect(review).toContainText("2 of 3 selected");
  await page.getByRole("button", { name: "Select all", exact: true }).click();
  await page
    .getByRole("button", { name: "Clear selection", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Select branch", exact: true })
    .click();
  await expect(review).toContainText("2 of 3 selected");
  await page.getByRole("button", { name: "Keep writing" }).click();
  await expect(
    page.getByRole("button", { name: "New note", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "More scratchpad actions" }),
  ).toHaveCount(0);
});

test("acknowledges slow native creates and prefetches actual record revisions before delete", async ({
  page,
}) => {
  const existing = taskRecord("Delete through the held client", "held-delete");
  await openFixture(page, { records: [existing], slowConfirmation: true });
  await expect(
    page.getByText("Delete through the held client", { exact: true }),
  ).toBeVisible();
  if (!(await page.getByLabel("New task title").isVisible()))
    await page.locator(".view-context-capture").click();
  const input = page.getByLabel("New task title").filter({ visible: true });
  await input.fill("Create through the held client");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await operations(page)).filter((op) => op === "create").length,
    )
    .toBe(1);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Adding “Create through the held client”…" }),
  ).toBeVisible();
  await expect(input).toHaveValue("Create through the held client");
  await expect(input).toHaveAttribute("readonly", "");
  await page.evaluate(() => window.__TASKNOTES_NEXT_SMOKE_CONTROL__!.confirm());
  await expect(
    page.getByRole("button", {
      name: "Create through the held client",
      exact: true,
    }),
  ).toBeVisible();
  const nativeId = await page.evaluate((path) => {
    const c = window.__TASKNOTES_NEXT_SMOKE_CONTROL__!;
    const id = c.records().find((r) => r.path === path)!.id;
    c.holdRead = id;
    return id;
  }, existing.path);
  const before = await page.evaluate(
    (id) => window.__TASKNOTES_NEXT_SMOKE_CONTROL__!.reads[id] ?? 0,
    nativeId,
  );
  await page
    .getByRole("button", {
      name: "Task actions for Delete through the held client",
    })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        (id) => window.__TASKNOTES_NEXT_SMOKE_CONTROL__!.reads[id] ?? 0,
        nativeId,
      ),
    )
    .toBe(before + 1);
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Delete task", exact: true }).click();
  // Native deletion must first READ the original complete snapshot and CAS
  // revision. The classic optimistic toast before that READ is intentionally
  // unavailable; neither deletion nor its undo claim can precede the snapshot.
  await expect(
    page.getByRole("button", { name: "Delete task", exact: true }),
  ).toBeDisabled();
  expect((await operations(page)).filter((op) => op === "delete")).toHaveLength(
    0,
  );
  await page.evaluate(() =>
    window.__TASKNOTES_NEXT_SMOKE_CONTROL__!.releaseReads(),
  );
  await expect(page.locator(".undo-toast")).toContainText(
    "Deleted “Delete through the held client”",
  );
  await page
    .getByRole("button", {
      name: "Task actions for Create through the held client",
    })
    .click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Delete task", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await operations(page)).filter((op) => op === "delete").length,
      { timeout: 12000 },
    )
    .toBe(1);
  await expect(page.locator(".undo-toast")).toContainText(
    "Deleted “Create through the held client”",
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    page.getByText("Delete through the held client", { exact: true }),
  ).toHaveCount(0);
  // Exactly one original prefetch; fresh SDK GETs for CAS and row hydration
  // are separate native reads, not duplicate prefetch requests.
  expect(
    await page.evaluate(
      (id) => window.__TASKNOTES_NEXT_SMOKE_CONTROL__!.prefetchReads[id] ?? 0,
      nativeId,
    ),
  ).toBe(1);
});

function status(
  value: string,
  label: string,
  order: number,
  isCompleted = false,
) {
  return {
    id: value,
    value,
    label,
    color: "#808080",
    isCompleted,
    order,
    autoArchive: false,
    autoArchiveDelay: 5,
  };
}
function priority(value: string, label: string, weight: number) {
  return { id: value, value, label, color: "#808080", weight };
}

test("edits a contract-defined task without collapsing custom status or fields through the held client", async ({
  page,
}) => {
  const configuration = {
    statuses: [
      status("todo", "To do", 1),
      status("doing", "In flight", 2),
      status("done", "Finished", 3, true),
    ],
    priorities: [
      priority("later", "Whenever", 1),
      priority("now", "Right now", 2),
    ],
    defaults: { status: "todo", priority: "later", taskTag: "task" },
    userFields: [
      {
        id: "energy",
        key: "energy",
        displayName: "Energy level",
        type: "number" as const,
      },
      {
        id: "client",
        key: "client",
        displayName: "Client",
        type: "text" as const,
      },
      {
        id: "owner",
        key: "owner",
        displayName: "Owner",
        type: "text" as const,
      },
      {
        id: "reviewedAt",
        key: "reviewedAt",
        displayName: "Reviewed At",
        type: "text" as const,
      },
      {
        id: "externalId",
        key: "externalId",
        displayName: "External ID",
        type: "text" as const,
      },
    ],
  };
  const generated = buildTaskNotesMdbaseResources({
    profiles: ["core-lite"],
    modelConfig: configuration,
  });
  const definition = generated.type as unknown as {
    schema: {
      value: { properties: Record<string, unknown>; required?: string[] };
    };
  };
  Object.assign(definition.schema.value.properties, {
    energy: { type: "integer", title: "Energy level" },
    client: { type: "string", title: "Client" },
    owner: { type: "string", title: "Owner", enum: ["Alex", "Sam"] },
    reviewedAt: { type: "string", title: "Reviewed At", format: "date-time" },
    externalId: { type: "string", title: "External ID", readOnly: true },
  });
  definition.schema.value.required = [
    ...(definition.schema.value.required ?? []),
    "owner",
  ];
  const task = new TaskNotesTaskModel(configuration).create(
    {
      title: "Respect the collection contract",
      priority: "now",
      customProperties: {
        energy: 4,
        client: "Acme",
        owner: "Alex",
        reviewedAt: "2026-07-22T10:00:00Z",
        externalId: "server-owned",
      },
    },
    { id: "configured-task", now: "2026-07-22T00:00:00.000Z" },
  );
  task.frontmatter.status = "doing";
  await openFixture(page, {
    records: [
      {
        path: task.path,
        frontmatter: task.frontmatter as Record<string, PlainValue>,
        body: task.body,
      },
    ],
    typeDefinition: generated.type,
  });
  await page
    .getByText("Respect the collection contract", { exact: true })
    .click();
  await expect(page.getByLabel("Status")).toHaveAttribute(
    "data-value",
    "doing",
  );
  await page
    .locator("details.task-form-section > summary")
    .filter({ hasText: /^Organize/ })
    .click();
  await expect(
    page.getByRole("button", { name: "Right now", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Energy level")).toHaveValue("4");
  await expect(page.getByLabel("Client")).toHaveValue("Acme");
  await expect(page.getByRole("combobox", { name: "Owner *" })).toHaveAttribute(
    "data-value",
    "Alex",
  );
  await expect(
    page.getByRole("button", { name: "Reviewed At date" }),
  ).toHaveAttribute("data-value", "2026-07-22");
  await expect(page.getByLabel("External ID")).toHaveAttribute("readonly", "");
  await page
    .getByLabel("Task title", { exact: true })
    .fill("Preserve the collection contract");
  await page.getByLabel("Client").fill("");
  await page.getByRole("combobox", { name: "Owner *" }).click();
  await page.getByRole("option").filter({ hasText: "Sam" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__TASKNOTES_NEXT_SMOKE_CONTROL__!.updates.length,
      ),
    )
    .toBeGreaterThan(0);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  const evidence = await page.evaluate(() => ({
    updates: window.__TASKNOTES_NEXT_SMOKE_CONTROL__!.updates,
    record: window.__TASKNOTES_NEXT_SMOKE_CONTROL__!.records()[0],
  }));
  const patch = Object.assign({}, ...evidence.updates.map((u) => u.patch));
  expect(patch).toMatchObject({
    title: "Preserve the collection contract",
    owner: "Sam",
  });
  // The native SDK represents removals explicitly, not classic relay null patches.
  expect(evidence.updates.flatMap((u) => u.unset)).toContain("client");
  expect(patch).not.toHaveProperty("status");
  expect(evidence.record.frontmatter.status).toBe("doing");
  expect(evidence.record.frontmatter.energy).toBe(4);
  expect(evidence.record.frontmatter).not.toHaveProperty("client");
  expect(
    evidence.updates.every((u) => u.ifRevision?.startsWith("sha256:")),
  ).toBe(true);
});

test("edits the captured migrated numeric property through the held client", async ({
  page,
}) => {
  const root = "tests/fixtures/mdbase-upgrades/app-custom/";
  const definition = parse(
    readFileSync(`${root}task.md`, "utf8").split("---")[1],
  );
  const captured = JSON.parse(readFileSync(`${root}record.json`, "utf8"));
  await openFixture(page, { records: [captured], typeDefinition: definition });
  await page
    .getByRole("button", { name: captured.frontmatter.summary, exact: true })
    .click();
  await page
    .locator("details.task-form-section > summary")
    .filter({ hasText: /^Organize/ })
    .click();
  await expect(page.getByLabel("Effort", { exact: true })).toHaveValue("0.5");
  await page.getByLabel("Effort", { exact: true }).fill("2");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__TASKNOTES_NEXT_SMOKE_CONTROL__!.updates.at(-1)?.patch.effort,
      ),
    )
    .toBe(2);
  const record = await page.evaluate(
    () => window.__TASKNOTES_NEXT_SMOKE_CONTROL__!.records()[0],
  );
  expect(record.frontmatter.effort).toBe(2);
  expect(record.body).toBe(captured.body);
});

test("keeps collection availability visible across cached search and explicit retry with a held client", async ({
  page,
}) => {
  await openFixture(page, {
    records: [taskRecord("Availability test task", "availability-task")],
  });
  await expect(
    page.getByText("Availability test task", { exact: true }),
  ).toBeVisible();
  await nav(page, "Settings");
  await page.evaluate(() => {
    window.__TASKNOTES_NEXT_SMOKE_CONTROL__!.offline = true;
  });
  await page.getByRole("button", { name: "Refresh now", exact: true }).click();
  const notice = page.getByRole("region", { name: "Collection connection" });
  await expect(notice).toContainText("Collection unavailable");
  await nav(page, "Search");
  await page.getByRole("searchbox").fill("Availability");
  await expect(
    page.getByText("Availability test task", { exact: true }),
  ).toBeVisible();
  await expect(notice).toContainText("Showing previously loaded tasks");
  await page.evaluate(() => {
    window.__TASKNOTES_NEXT_SMOKE_CONTROL__!.offline = false;
  });
  await notice
    .getByRole("button", { name: "Retry connection", exact: true })
    .click();
  await expect(notice).toHaveCount(0);
});
