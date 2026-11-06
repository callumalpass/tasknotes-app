import { expect, test } from "@playwright/test";

test("detail properties are directly editable and adjacent navigation saves notes", async ({
  page,
}) => {
  await page.goto("?demo=60");
  await expect(page.locator(".task-row-title").first()).toBeVisible();
  const titles = await page.locator(".task-row-title-text").allTextContents();
  const first = titles[0].trim();
  const next = titles[1].trim();
  await page.getByRole("button", { name: first, exact: true }).click();
  const pane = page.getByRole("complementary", {
    name: "Task details",
    exact: true,
  });
  await expect(
    pane.getByRole("button", { name: "Previous task", exact: true }),
  ).toBeDisabled();
  for (const name of ["Status", "Priority"])
    await expect(
      pane.getByRole("combobox", { name, exact: true }),
    ).toBeVisible();
  for (const name of [
    "Scheduled date",
    "Due date",
    "Edit Project",
    "Edit Tags",
  ])
    await expect(pane.getByRole("button", { name, exact: true })).toBeVisible();
  await pane.getByRole("button", { name: "Write", exact: true }).click();
  const notes = pane.getByRole("textbox", { name: "Notes", exact: true });
  await notes.fill("A note saved before browsing.");
  await page.keyboard.press("j");
  await expect(
    pane.getByRole("textbox", { name: "Task title", exact: true }),
  ).toHaveValue(first);
  await pane.getByRole("button", { name: "Next task", exact: true }).click();
  await expect(
    pane.getByRole("textbox", { name: "Task title", exact: true }),
  ).toHaveValue(next);
  await pane.focus();
  await page.keyboard.press("k");
  await expect(
    pane.getByRole("textbox", { name: "Task title", exact: true }),
  ).toHaveValue(first);
  await expect(pane.locator(".markdown-preview")).toContainText(
    "A note saved before browsing.j",
  );
  await pane.getByRole("combobox", { name: "Priority", exact: true }).click();
  await page.keyboard.press("j");
  await expect(
    pane.getByRole("textbox", { name: "Task title", exact: true }),
  ).toHaveValue(first);
  await page.keyboard.press("Escape");
  await pane.focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect(
    pane.getByRole("textbox", { name: "Task title", exact: true }),
  ).toHaveValue(next);
});

test("inline subtasks create, complete and open without losing the parent draft", async ({
  page,
}) => {
  await page.goto("?demo=60");
  await page
    .getByRole("button", {
      name: "Prepare quarterly planning session",
      exact: true,
    })
    .click();
  const pane = page.getByRole("complementary", {
    name: "Task details",
    exact: true,
  });
  await pane
    .getByRole("textbox", { name: "Subtask title", exact: true })
    .fill("Collect planning questions");
  await pane.getByRole("button", { name: "Add subtask", exact: true }).click();
  await expect(pane.getByText("0 of 1", { exact: true })).toBeVisible();

  await pane
    .getByRole("button", {
      name: "Complete Collect planning questions",
      exact: true,
    })
    .click();
  await expect(pane.getByText("1 of 1", { exact: true })).toBeVisible();
  await pane
    .getByRole("button", { name: "Collect planning questions", exact: true })
    .click();
  await expect(
    pane.getByRole("textbox", { name: "Task title", exact: true }),
  ).toHaveValue("Collect planning questions");
  await expect(
    pane.getByRole("button", { name: "Edit Project", exact: true }),
  ).toContainText("Prepare quarterly planning session");
});

for (const source of ["today", "search"] as const)
  test(`adjacent navigation includes unrendered rows in ${source}`, async ({
    page,
  }) => {
    // Exercise the long traversal with the supported reduced-motion setting.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(source === "search" ? "search?demo=600" : "?demo=600");
    if (source === "search")
      await page
        .getByRole("searchbox", { name: "Search tasks" })
        .fill("demo task");
    await expect(page.locator(".task-row-title").first()).toBeVisible();
    const initialTitles = (
      await page.locator(".task-row-title-text").allTextContents()
    ).map((title) => title.trim());
    expect(initialTitles.length).toBeLessThan(100);
    await page
      .getByRole("button", { name: initialTitles[0], exact: true })
      .click();
    const pane = page.getByRole("complementary", {
      name: "Task details",
      exact: true,
    });
    for (let index = 0; index < initialTitles.length; index++) {
      const before = await pane
        .getByRole("textbox", { name: "Task title", exact: true })
        .inputValue();
      await pane
        .getByRole("button", { name: "Next task", exact: true })
        .click();
      await expect(
        pane.getByRole("textbox", { name: "Task title", exact: true }),
      ).not.toHaveValue(before);
    }
    expect(initialTitles).not.toContain(
      await pane
        .getByRole("textbox", { name: "Task title", exact: true })
        .inputValue(),
    );
  });
