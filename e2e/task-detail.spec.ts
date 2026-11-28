import { expect, test } from "@playwright/test";

test("task Notes reveal syntax only where you edit and retain the Markdown", async ({
  page,
}) => {
  await page.goto("?demo=60");
  await page.locator(".task-row-title").first().click();
  const notes = page.getByRole("textbox", { name: "Notes", exact: true });
  const source =
    "**A bolded heading**\n\n[[Some Note#Some heading|Section]]\n\n> [!summary]+ Summary\n> Some callout content.\n\n[Reference](https://example.test/docs)";
  await notes.fill(source);
  const title = page.getByRole("textbox", { name: "Task title", exact: true });
  await title.focus();
  await expect(notes.locator(".cm-lp-strong")).toHaveText("A bolded heading");
  await expect(notes.locator(".cm-lp-callout").first()).toContainText(
    "Summary",
  );
  await expect(notes.getByText("Section", { exact: true })).toBeVisible();
  await expect(notes).not.toContainText("[!summary]");
  await expect(notes.locator("a")).toHaveAttribute(
    "href",
    "https://example.test/docs",
  );

  await notes.locator(".cm-lp-strong").click();
  await expect(notes).toBeFocused();
  await expect(notes).toContainText("**A bolded heading**");
  await expect(notes).not.toContainText("[[Some Note#Some heading|Section]]");
  await title.focus();
  await expect(notes).not.toContainText("**A bolded heading**");

  await page
    .context()
    .route("https://example.test/docs", (route) =>
      route.fulfill({ body: "Documentation" }),
    );
  const [popup] = await Promise.all([
    page.context().waitForEvent("page", { timeout: 5_000 }),
    notes.locator("a").click(),
  ]);
  await expect(popup.getByText("Documentation")).toBeVisible();
  await popup.close();

  await page.getByRole("button", { name: "Next task", exact: true }).click();
  await page
    .getByRole("button", { name: "Previous task", exact: true })
    .click();
  await expect(notes.locator(".cm-lp-strong")).toHaveText("A bolded heading");
  await notes.focus();
  await notes.press("ControlOrMeta+a");
  await expect
    .poll(() => notes.evaluate(() => window.getSelection()?.toString()))
    .toBe(source);
});

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
  for (const name of ["Scheduled date", "Due date", "Edit Project"])
    await expect(pane.getByRole("button", { name, exact: true })).toBeVisible();
  await pane.getByRole("button", { name: "Add property", exact: true }).click();
  await page.getByRole("menuitem", { name: "Reminders", exact: true }).click();
  await expect(
    pane.getByRole("button", { name: "Edit Reminders", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await pane.getByRole("button", { name: "Edit Tags", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Tags", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(
    pane.getByRole("button", { name: "Edit Tags", exact: true }),
  ).toBeFocused();
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
  await expect(notes).toContainText("A note saved before browsing.j");
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
  // Without subtasks the section is a single action until it is used.
  await pane.getByRole("button", { name: "Add subtask", exact: true }).click();
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

test("a list row counts its subtasks and opens them in place", async ({
  page,
}) => {
  await page.goto("?demo=60");
  const parent = "Prepare quarterly planning session";
  await page.getByRole("button", { name: parent, exact: true }).click();
  const pane = page.getByRole("complementary", {
    name: "Task details",
    exact: true,
  });
  await pane.getByRole("button", { name: "Add subtask", exact: true }).click();
  for (const title of ["Collect planning questions", "Book the room"]) {
    await pane
      .getByRole("textbox", { name: "Subtask title", exact: true })
      .fill(title);
    await pane
      .getByRole("button", { name: "Add subtask", exact: true })
      .click();
    await expect(
      pane.getByRole("button", { name: title, exact: true }),
    ).toBeVisible();
  }

  const main = page.locator("#main-content");
  const row = main.locator(".task-row", {
    has: page.getByRole("button", { name: parent, exact: true }),
  });
  const toggle = row.getByRole("button", {
    name: "Subtasks: 0 of 2",
    exact: true,
  });
  await expect(toggle).toHaveText("0/2");
  await toggle.click();
  const subtasks = row.getByRole("group", { name: `Subtasks of ${parent}` });
  await expect(
    subtasks.getByRole("button", { name: "Book the room", exact: true }),
  ).toBeVisible();

  await subtasks
    .getByRole("button", {
      name: "Complete Collect planning questions",
      exact: true,
    })
    .click();
  await expect(
    row.getByRole("button", { name: "Subtasks: 1 of 2", exact: true }),
  ).toHaveText("1/2");
  // The parent is untouched by keys pressed on a listed subtask.
  await subtasks
    .getByRole("button", { name: "Book the room", exact: true })
    .press("x");
  await expect(row).not.toHaveAttribute("data-task-completed", "true");
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

test("narrow Notes tables keep short words intact and scroll wide rows inside Notes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 760 });
  await page.goto("?demo=60");
  await page.locator(".task-row-title").first().click();
  const notes = page.getByRole("textbox", { name: "Notes", exact: true });
  const title = page.getByRole("textbox", { name: "Task title", exact: true });
  const description = "A sentence with several words. ".repeat(10);
  await notes.fill(
    `| Item | Description |\n| --- | --- |\n| cell | ${description} |\n\n`,
  );
  await title.focus();
  for (const word of ["Item", "cell"]) {
    const text = notes.getByText(word, { exact: true }).first();
    await expect(text).toBeVisible();
    expect(
      await text.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return new Set(Array.from(range.getClientRects(), (rect) => rect.top))
          .size;
      }),
    ).toBe(1);
  }
  const token = "x".repeat(120);
  await notes.fill(
    `| Item | Identifier |\n| --- | --- |\n| cell | ${token} |\n\n`,
  );
  await title.focus();
  const frame = notes.locator(".cm-lp-table-frame");
  await expect(frame).toContainText(token);
  expect(await frame.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
    true,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
