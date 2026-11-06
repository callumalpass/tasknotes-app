import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./local-test";

test("opens and navigates the disposable demo repository", async ({ page }) => {
  await page.goto("?demo=50");

  await expect(
    page.getByRole("heading", { level: 1, name: "Today", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Prepare quarterly planning session"),
  ).toBeVisible();
  await expect(page).toHaveURL(/demo=50/);

  await page.getByRole("button", { name: "Scratchpad", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Scratchpad", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/scratchpad\?demo=50/);
  const planningHistory = page.getByRole("button", { name: /Planning notes/ });
  await expect(planningHistory).toHaveAttribute("aria-expanded", "false");
  await planningHistory.click();
  await expect(
    page.getByRole("textbox", { name: "Draft task: Confirm the review date" }),
  ).toBeVisible();
  await expect(page.getByText("Image file is unavailable")).toBeVisible();
  await page.getByRole("button", { name: "Collapse image" }).click();
  await expect(page.getByText("Image file is unavailable")).toHaveCount(0);
  await page.getByRole("button", { name: "Expand image" }).click();
  await expect(page.getByText("Image file is unavailable")).toBeVisible();
  await expect(page.getByRole("button", { name: "New note" })).toBeVisible();
  await page.getByRole("button", { name: "Add image" }).click();
  await expect(page.getByText(/Drop images here/)).toBeVisible();
  await expect(page.getByLabel("Upload images")).toHaveAttribute(
    "accept",
    "image/*",
  );
  await expect(page.getByLabel("Take photo")).toHaveAttribute(
    "capture",
    "environment",
  );
  await page.getByRole("button", { name: "Close image capture" }).click();
  await expect(
    page.getByRole("region", { name: "Scratchpad" }).getByText(/archive/i),
  ).toHaveCount(0);
  const currentScratchpad = page.getByRole("region", {
    name: "Editor for current scratchpad",
  });
  await expect
    .poll(() =>
      currentScratchpad.evaluate(
        (editor) =>
          getComputedStyle(editor.closest(".scratchpad-current-document")!)
            .overflow,
      ),
    )
    .toBe("visible");
  await expect(
    currentScratchpad.getByRole("button", { name: "Add task" }),
  ).toHaveCount(0);
  await currentScratchpad.getByRole("button", { name: "Write" }).click();
  const markdown = currentScratchpad.getByRole("textbox", {
    name: "Scratchpad Markdown",
  });
  await markdown.fill("# Freeform Markdown\n\nAnything can go here.\n");
  await currentScratchpad.getByRole("button", { name: "Outline" }).click();
  await expect(currentScratchpad).toContainText(
    "This Markdown contains blocks the outline cannot represent",
  );

  await openNavigationItem(page, "Search");
  const search = page.getByRole("searchbox", { name: "Search tasks" });
  await search.fill("planning");
  await expect(
    page.getByText("Prepare quarterly planning session"),
  ).toBeVisible();
  await search.blur();

  await openNavigationItem(page, "Settings");
  await expect(page.getByText("TaskNotes demo").first()).toBeVisible();
  await expect(page).toHaveURL(/\/more\?demo=50/);
  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByText("Collection", { exact: true })
    .click();
  await expect(page.getByText("47 total")).toBeVisible();
  await expect(page).toHaveURL(/\/more\/collection\?demo=50/);
});

test("opens a trailing-slash Scratchpad route and focuses current capture", async ({
  page,
}) => {
  await page.goto("scratchpad/?demo=12");
  await expect(
    page.getByRole("heading", { name: "Scratchpad", exact: true }),
  ).toBeVisible();
  const current = page.getByRole("region", {
    name: "Editor for current scratchpad",
  });
  await expect(current.locator("[data-scratch-input]:focus")).toHaveCount(1);
  await current
    .getByRole("button", { name: "Actions for empty item" })
    .last()
    .click();
  await expect(
    current.getByRole("menu", { name: /Actions for/ }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await current.getByRole("button", { name: "Write" }).click();
  await expect(
    current.getByRole("textbox", { name: "Scratchpad Markdown" }),
  ).toBeFocused();
  for (let index = 0; index < 3; index += 1) {
    await current.getByRole("button", { name: "Outline" }).click();
    await expect(
      current.getByRole("tree", { name: "Scratchpad outline" }),
    ).toBeVisible();
    await current.getByRole("button", { name: "Write" }).click();
    await expect(
      current.getByRole("textbox", { name: "Scratchpad Markdown" }),
    ).toBeFocused();
  }
});

test("resumes a historical Scratchpad as the current note", async ({
  page,
}) => {
  await page.goto("scratchpad/?demo=12");
  await page.getByRole("button", { name: /Planning notes/ }).click();
  const historical = page.getByRole("region", {
    name: "Editor for Planning notes",
  });
  await expect(
    historical.getByRole("textbox", {
      name: "Draft task: Confirm the review date",
    }),
  ).toBeVisible();
  await historical.getByRole("button", { name: "Resume as current" }).click();

  const current = page.locator(".scratchpad-current-document");
  await expect(
    current.getByRole("region", { name: "Editor for Planning notes" }),
  ).toBeVisible();
  await expect(
    current.getByRole("textbox", {
      name: "Draft task: Confirm the review date",
    }),
  ).toBeVisible();
  await expect(current.locator("[data-scratch-input]:focus")).toHaveCount(1);
  await expect(page.getByText("Planning notes resumed")).toBeVisible();
});

test("deletes a previous Scratchpad note behind an Undo window", async ({
  page,
}) => {
  await page.goto("scratchpad/?demo=12");
  const planning = page.getByRole("button", { name: /Planning notes/ });
  await expect(planning).toBeVisible();
  const current = page.locator(".scratchpad-current-document");
  await expect(
    current.getByRole("button", { name: "Note actions" }),
  ).toHaveCount(0);
  const card = page.locator(".scratchpad-document", { has: planning });
  const actions = card.getByRole("button", { name: "Note actions" });

  await actions.click();
  const remove = page.getByRole("menuitem", { name: "Delete note" });
  await expect(remove).toBeFocused();
  await expect(remove).toBeInViewport({ ratio: 1 });
  await remove.click();

  await expect(planning).toHaveCount(0);
  await expect(page.getByText("Deleted “Planning notes”")).toBeVisible();
  const undo = page.getByRole("button", { name: "Undo" });
  await expect(undo).toBeFocused();
  await undo.click();
  await expect(planning).toBeVisible();
  await expect(page.getByText("Deleted “Planning notes”")).toHaveCount(0);

  await actions.click();
  await remove.click();
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByText("Deleted “Planning notes”")).toHaveCount(0);
  await expect(planning).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Editor for current scratchpad" }),
  ).toBeVisible();
});

test("continues on a fresh line after converting the final outline draft", async ({
  page,
}) => {
  await page.goto("scratchpad/?demo=12");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  const current = page.getByRole("region", {
    name: "Editor for current scratchpad",
  });
  const input = current.locator("[data-scratch-input]").last();
  await input.fill("Continue after conversion");
  await current
    .getByRole("button", {
      name: "Actions for Continue after conversion",
      exact: true,
    })
    .click();
  await current
    .getByRole("menuitem", { name: "Create task", exact: true })
    .click();
  await expect(
    current.getByRole("button", {
      name: "Continue after conversion",
      exact: true,
    }),
  ).toBeVisible();
  const next = current.getByRole("textbox", {
    name: "Draft task: empty",
    exact: true,
  });
  await expect(next).toBeFocused();
  await next.fill("The next thought");
  await expect(current.locator("[data-scratch-input]").last()).toHaveValue(
    "The next thought",
  );
});

test("keeps the caret and completion at a multiline paste in an outline item", async ({
  page,
}) => {
  await page.goto("scratchpad/?demo=12");
  const current = page.getByRole("region", {
    name: "Editor for current scratchpad",
  });
  const input = current.locator("[data-scratch-input]").last();
  await input.fill("Before after");
  await input.evaluate((element) => {
    const textarea = element as HTMLTextAreaElement;
    textarea.setSelectionRange(7, 7);
    textarea.setRangeText("one\n\n[[quarterly ", 7, 7, "end");
    textarea.setSelectionRange(
      textarea.selectionStart - 1,
      textarea.selectionStart - 1,
    );
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(input).toHaveValue("Before one [[quarterly after");
  await expect
    .poll(() =>
      input.evaluate(
        (element) => (element as HTMLTextAreaElement).selectionStart,
      ),
    )
    .toBe("Before one [[quarterly".length);
  await expect(
    current.getByRole("option", { name: /Prepare quarterly planning session/ }),
  ).toBeVisible();
});

test("configures the default mode for new Scratchpad notes", async ({
  page,
}) => {
  await page.goto("more/device?demo=12");
  await page.getByRole("combobox", { name: "Default Scratchpad mode" }).click();
  await page.getByRole("option", { name: "Write", exact: true }).click();
  await page.goto("scratchpad/?demo=12");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  const current = page.getByRole("region", {
    name: "Editor for current scratchpad",
  });
  await expect(
    current.getByRole("button", { name: "Write", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    current.getByRole("textbox", { name: "Scratchpad Markdown" }),
  ).toBeFocused();
  await current.getByRole("button", { name: "Outline", exact: true }).click();
  await expect(
    current.getByRole("button", { name: "Outline", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await expect(
    current.getByRole("button", { name: "Write", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("writing tools preserve selection and support Undo and Redo", async ({
  page,
}) => {
  await page.goto("scratchpad/?demo=12");
  const current = page.getByRole("region", {
    name: "Editor for current scratchpad",
  });
  await current.getByRole("button", { name: "Write", exact: true }).click();
  const source = current.getByRole("textbox", { name: "Scratchpad Markdown" });
  await source.fill("A thought worth keeping");
  await source.press("ControlOrMeta+a");
  await current.getByRole("button", { name: "Bold", exact: true }).click();
  await expect(source).toHaveText("**A thought worth keeping**");
  await expect(source).toBeFocused();
  await expect(current.getByText("4 words", { exact: true })).toHaveCount(0);
  await expect(current.getByText(/Markdown supported/)).toHaveCount(0);
  await expect(current.locator(".cm-placeholder")).toHaveCount(0);
  await expect(current.getByText("Saved", { exact: true })).toBeVisible();
  await expect(current.getByRole("status")).toHaveCount(0);
  await source.press("ControlOrMeta+z");
  await expect(source).toHaveText("A thought worth keeping");
  await source.press("ControlOrMeta+y");
  await expect(source).toHaveText("**A thought worth keeping**");
  const result = await new AxeBuilder({ page })
    .include(".scratchpad-writing-surface")
    .analyze();
  expect(
    result.violations.filter(({ impact }) =>
      ["critical", "serious"].includes(impact ?? ""),
    ),
  ).toEqual([]);
});

test("suggests wikilinks in Scratchpad Outline and Markdown", async ({
  page,
}) => {
  await page.goto("scratchpad/?demo=12");
  const current = page.getByRole("region", {
    name: "Editor for current scratchpad",
  });
  const outlineInput = current.locator("[data-scratch-input]").last();
  await outlineInput.fill("[[quarterly");
  const outlineOption = current.getByRole("option", {
    name: /Prepare quarterly planning session/,
  });
  await expect(outlineOption).toBeVisible();
  await outlineOption.click();
  await expect(
    current.getByRole("button", {
      name: "Prepare quarterly planning session",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    current.getByRole("textbox", { name: "Draft task: empty" }).last(),
  ).toBeFocused();

  await current.getByRole("button", { name: "Write" }).click();
  const source = current.getByRole("textbox", {
    name: "Scratchpad Markdown",
  });
  await expect(source).toContainText("- Prepare quarterly planning session");
  await expect(source).not.toContainText(
    "[ ] Prepare quarterly planning session",
  );
  await source.fill("[[quarterly");
  const markdownOption = current.getByRole("option", {
    name: /Prepare quarterly planning session/,
  });
  await expect(markdownOption).toBeVisible();
  await expect(markdownOption.locator(".cm-completionIcon")).toBeHidden();
  await markdownOption.click();
  await expect(source).toHaveText(
    /\[\[tasks\/.*\|Prepare quarterly planning session\]\]/,
  );
});

test("supports project capture and saved-view editing in the demo", async ({
  page,
}) => {
  await page.goto("embed/?demo=24");
  await page
    .getByRole("heading", { level: 1, name: "Today", exact: true })
    .waitFor();

  await openNavigationItem(page, "Projects");
  await page
    .getByRole("button", { name: "Add task to Field research" })
    .click();
  const projectCapture = page.getByRole("combobox", {
    name: "New task title",
  });
  await projectCapture.fill("Draft the interview guide");
  await projectCapture.press("Enter");
  await expect(
    page.getByRole("button", {
      name: "Draft the interview guide",
      exact: true,
    }),
  ).toBeVisible();

  await openNavigationItem(page, "Views");
  await page.getByRole("button", { name: "More actions for Today" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  const viewName = page.getByRole("textbox", { name: "View name" });
  await viewName.fill("Daily focus");
  await page.getByRole("button", { name: "Save view" }).click();
  await expect(
    page.getByRole("button", { name: /^Daily focus/ }).first(),
  ).toBeVisible();
});

async function openNavigationItem(page: Page, name: string): Promise<void> {
  const direct = page.getByRole("button", { name, exact: true });
  if (await direct.isVisible()) {
    await direct.click();
    return;
  }
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}

test("supports demo attachments and collection settings", async ({ page }) => {
  await page.goto("embed/?demo=24");
  await page
    .getByRole("button", {
      name: "Prepare quarterly planning session",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Attachments" }),
  ).toBeVisible();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "demo-pixel.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  await expect(page.getByText("demo-pixel.png")).toBeVisible();

  await page
    .getByRole("button", { name: /^(Back|Close task details)$/ })
    .click();
  await openNavigationItem(page, "Settings");
  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByText("Collection behavior", { exact: true })
    .click();
  await page.getByRole("combobox", { name: "Default priority" }).click();
  await page.getByRole("option", { name: "High", exact: true }).click();
  await expect(
    page.getByText("Unsaved changes for everyone using this collection"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved with the collection.")).toBeVisible();
});

test("demo work screen has no serious accessibility violations", async ({
  page,
}) => {
  await page.goto("?demo=12");
  await expect(
    page.getByText("Prepare quarterly planning session"),
  ).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  expect(
    results.violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical",
    ),
  ).toEqual([]);
});

test("browser Back keeps an unsaveable task draft open", async ({ page }) => {
  await page.goto("?demo=50");
  await page.getByText("Send the research summary to Rowan").first().click();
  const title = page.locator("#task-title");
  await title.fill("");
  const notes = page.locator("textarea[aria-labelledby='task-notes-title']");
  await notes.fill("Unsaved draft body");
  await title.focus();
  await page.goBack();
  await expect(page).toHaveURL(/\/task\//);
  await expect(title).toHaveValue("");
  await expect(notes).toHaveValue("Unsaved draft body");
});
