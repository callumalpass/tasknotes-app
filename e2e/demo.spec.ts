import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./local-test";
import { noteText, outlineOf } from "./scratchpad-editor";

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
    outlineOf(page.getByRole("region", { name: "Editor for Planning notes" })),
  ).toContainText("Confirm the review date");
  // An image is a line in the list until it is opened.
  await expect(page.getByText("Image file is unavailable")).toHaveCount(0);
  await page.getByRole("button", { name: "Expand image" }).click();
  await expect(page.getByText("Image file is unavailable")).toBeVisible();
  await page.getByRole("button", { name: "Collapse image" }).click();
  await expect(page.getByText("Image file is unavailable")).toHaveCount(0);
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
  // One editor takes the outline and anything else Markdown can say.
  await expect(
    currentScratchpad.getByRole("button", { name: "Write" }),
  ).toHaveCount(0);
  const note = outlineOf(currentScratchpad);
  await note.fill("# Freeform Markdown\n\nAnything can go here.");
  await expect(note).toContainText("Freeform Markdown");
  await expect(note).toContainText("Anything can go here.");
  await expect(currentScratchpad.getByRole("alert")).toHaveCount(0);

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
  await expect(outlineOf(current)).toBeFocused();
  await expect(current.getByRole("button", { name: "Write" })).toHaveCount(0);
  await expect(current.getByRole("button", { name: "Outline" })).toHaveCount(0);
});

test("writes an outline with the keyboard: tasks, nesting, moving and folding", async ({
  page,
}) => {
  await page.goto("scratchpad/?demo=12");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  const current = page.getByRole("region", {
    name: "Editor for current scratchpad",
  });
  const note = outlineOf(current);
  await expect(note).toBeFocused();
  // A new note starts on a draft; Enter continues the list and Tab nests.
  await page.keyboard.type("Book the venue");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Confirm catering");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  // Enter on an empty item steps back out one level.
  await page.keyboard.press("Enter");
  await page.keyboard.type("Send the agenda");
  await expect
    .poll(() => noteText(note))
    .toBe(
      "- [ ] Book the venue\n  - [ ] Confirm catering\n- [ ] Send the agenda",
    );
  await expect(note.locator(".cm-lp-task")).toHaveCount(3);

  await page.keyboard.press("Alt+ArrowUp");
  await expect
    .poll(() => noteText(note))
    .toBe(
      "- [ ] Send the agenda\n- [ ] Book the venue\n  - [ ] Confirm catering",
    );

  const fold = current.getByRole("button", {
    name: /^Collapse Book the venue/,
  });
  await fold.click();
  await expect(note).not.toContainText("Confirm catering");
  await current.getByRole("button", { name: /^Expand Book the venue/ }).click();
  await expect(note).toContainText("Confirm catering");
  // Folding is a view of the note, not a change to it.
  await expect
    .poll(() => noteText(note))
    .toBe(
      "- [ ] Send the agenda\n- [ ] Book the venue\n  - [ ] Confirm catering",
    );
});

test("leaves the list from an empty item to write freely", async ({ page }) => {
  await page.goto("scratchpad/?demo=12");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  const note = outlineOf(
    page.getByRole("region", { name: "Editor for current scratchpad" }),
  );
  await expect(note).toBeFocused();
  await page.keyboard.type("One thing to do");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Then some plain words.");
  await expect
    .poll(() => noteText(note))
    .toBe("- [ ] One thing to do\n\nThen some plain words.");
});

test("resumes a historical Scratchpad as the current note", async ({
  page,
}) => {
  await page.goto("scratchpad/?demo=12");
  await page.getByRole("button", { name: /Planning notes/ }).click();
  const historical = page.getByRole("region", {
    name: "Editor for Planning notes",
  });
  await expect(outlineOf(historical)).toContainText("Confirm the review date");
  await historical.getByRole("button", { name: "Resume as current" }).click();

  const current = page.locator(".scratchpad-current-document");
  await expect(
    current.getByRole("region", { name: "Editor for Planning notes" }),
  ).toBeVisible();
  await expect(outlineOf(current)).toContainText("Confirm the review date");
  await expect(outlineOf(current)).toBeFocused();
  await expect(page.getByText("Planning notes resumed")).toBeVisible();
});

test("opens an earlier note on its own line and closes it from there", async ({
  page,
}) => {
  await page.goto("scratchpad/?demo=12");
  await expect(
    outlineOf(
      page.getByRole("region", { name: "Editor for current scratchpad" }),
    ),
  ).toBeFocused();
  await page.getByRole("button", { name: "Earlier notes" }).click();
  await expect
    .poll(() =>
      page
        .locator(".scratchpad-history-scroll")
        .evaluate((element) => element.scrollTop),
    )
    .toBe(0);
  const row = page.getByRole("button", { name: /Planning notes/ });
  const closed = await row.boundingBox();
  await row.click();
  const opened = page.getByRole("region", {
    name: "Editor for Planning notes",
  });
  await expect(opened.getByRole("textbox", { name: "Note title" })).toHaveValue(
    "Planning notes",
  );
  // The note opens where its line was, with one action beside its name.
  const header = await opened.locator(".scratchpad-note-header").boundingBox();
  expect(Math.abs(header!.y - closed!.y)).toBeLessThan(2);
  await expect(
    opened.getByRole("button", { name: "Resume as current" }),
  ).toBeVisible();
  await expect(
    opened.getByRole("button", { name: "Create tasks" }),
  ).toHaveCount(0);
  await opened.getByRole("button", { name: "Collapse" }).click();
  await expect(row).toHaveAttribute("aria-expanded", "false");
});

test("leads to earlier notes from the Scratchpad heading", async ({ page }) => {
  await page.goto("scratchpad/?demo=12");
  const scroller = page.locator(".scratchpad-history-scroll");
  await expect(
    outlineOf(
      page.getByRole("region", { name: "Editor for current scratchpad" }),
    ),
  ).toBeFocused();
  await expect
    .poll(() => scroller.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "Earlier notes" }).click();
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(0);
  await expect(
    page.getByRole("button", { name: /Planning notes/ }),
  ).toBeInViewport();
});

test("deletes a previous Scratchpad note behind an Undo window", async ({
  page,
}) => {
  await page.route(
    /scratchpad-note-editor[^/]*\.(tsx|js)(\?.*)?$/,
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      await route.continue();
    },
  );
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
  // The current note's editor arrives after the page. It takes neither the
  // focus nor the scroll position from a menu that is already open.
  await expect(outlineOf(current)).toBeVisible();
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
  const note = outlineOf(current);
  await expect(note).toBeFocused();
  await page.keyboard.type("Continue after conversion tomorrow");
  // What the line has been read as shows while it is written.
  await expect(current.getByLabel("Recognized task details")).toContainText(
    "Tomorrow",
  );
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(
    current.getByRole("button", {
      name: "Continue after conversion",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Created “Continue after conversion”"),
  ).toBeVisible();
  await expect(note).toBeFocused();
  await page.keyboard.type("The next thought");
  await expect
    .poll(() => noteText(note))
    .toMatch(
      /^- \[\[tasks\/[^\]]+\|Continue after conversion\]\]\n- \[ \] The next thought$/,
    );

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Conversion undone")).toBeVisible();
  await expect
    .poll(() => noteText(note))
    .toBe("- [ ] Continue after conversion tomorrow\n- [ ] The next thought");
});

test("keeps the caret at the end of a draft's text while typing", async ({
  page,
}) => {
  await page.goto("scratchpad/?demo=12");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  const current = page.getByRole("region", {
    name: "Editor for current scratchpad",
  });
  const note = outlineOf(current);
  await expect(note).toBeFocused();
  // The date is read as it is typed, so the line carries both its details
  // and its button after the text.
  await page.keyboard.type("Call the venue tomorrow");
  const line = note.locator(".cm-line", { hasText: "Call the venue" });
  await expect(line.locator(".cm-scratch-details")).toBeVisible();
  await expect(
    line.getByRole("button", {
      name: "Create task for Call the venue tomorrow",
    }),
  ).toBeVisible();
  await expect
    .poll(() =>
      current.evaluate((region) => {
        const caret = region.querySelector(".cm-cursor-primary");
        const text = [
          ...(region.querySelector(".cm-scratch-active")?.childNodes ?? []),
        ].find((node) => node.nodeType === Node.TEXT_NODE);
        if (!caret || !text) return Number.NaN;
        const range = document.createRange();
        range.selectNodeContents(text);
        return Math.abs(
          caret.getBoundingClientRect().left -
            range.getBoundingClientRect().right,
        );
      }),
    )
    .toBeLessThan(2);
});

test("creates a task from the button on a draft's line", async ({ page }) => {
  await page.goto("scratchpad/?demo=12");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  const current = page.getByRole("region", {
    name: "Editor for current scratchpad",
  });
  const note = outlineOf(current);
  await note.fill("- [ ] First draft\n- [ ] Second draft");
  const line = note.locator(".cm-line", { hasText: "First draft" });
  await line.hover();
  await line
    .getByRole("button", { name: "Create task for First draft" })
    .click();
  await expect(page.getByText("Created “First draft”")).toBeVisible();
  // A draft in the middle of a list becomes a task where it stands.
  await expect
    .poll(() => noteText(note))
    .toMatch(/^- \[\[tasks\/[^\]]+\|First draft\]\]\n- \[ \] Second draft$/);
  const mark = current.getByRole("checkbox", { name: "First draft" });
  await expect(mark).toHaveAttribute("aria-checked", "false");
  await mark.click();
  await expect(mark).toHaveAttribute("aria-checked", "true");
});

test("writing tools preserve selection and support Undo and Redo", async ({
  page,
}) => {
  await page.goto("scratchpad/?demo=12");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  const current = page.getByRole("region", {
    name: "Editor for current scratchpad",
  });
  const source = outlineOf(current);
  await source.fill("A thought worth keeping");
  await source.press("ControlOrMeta+a");
  await source.press("ControlOrMeta+b");
  await expect.poll(() => noteText(source)).toBe("**A thought worth keeping**");
  await expect(source).toBeFocused();
  await expect(current.locator(".cm-placeholder")).toHaveCount(0);
  await expect(current.getByText("Saved", { exact: true })).toBeVisible();
  await expect(current.getByRole("status")).toHaveCount(0);
  await source.press("ControlOrMeta+z");
  await expect.poll(() => noteText(source)).toBe("A thought worth keeping");
  await source.press("ControlOrMeta+y");
  await expect.poll(() => noteText(source)).toBe("**A thought worth keeping**");
  const result = await new AxeBuilder({ page })
    .include(".scratchpad-note-surface")
    .analyze();
  expect(
    result.violations.filter(({ impact }) =>
      ["critical", "serious"].includes(impact ?? ""),
    ),
  ).toEqual([]);
});

test("suggests wikilinks and capture shorthand in a Scratchpad note", async ({
  page,
}) => {
  await page.goto("scratchpad/?demo=12");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  const current = page.getByRole("region", {
    name: "Editor for current scratchpad",
  });
  const note = outlineOf(current);
  await expect(note).toBeFocused();
  await page.keyboard.type("[[quarterly");
  const option = current.getByRole("option", {
    name: /Prepare quarterly planning session/,
  });
  await expect(option).toBeVisible();
  await expect(option.locator(".cm-completionIcon")).toBeHidden();
  // The editor ignores Enter for a moment after suggestions appear, so that
  // a line break typed in passing is not taken as a choice.
  await page.waitForTimeout(200);
  await page.keyboard.press("Enter");
  // A line that is only a link to a task is that task, and writing moves on.
  await expect(
    current.getByRole("button", {
      name: "Prepare quarterly planning session",
      exact: true,
    }),
  ).toBeVisible();
  await expect
    .poll(() => noteText(note))
    .toMatch(
      /^- \[\[tasks\/[^\]]+\|Prepare quarterly planning session\]\]\n- \[ \] $/,
    );

  await page.keyboard.type("Call Sam #wo");
  const tag = current.getByRole("option", { name: /work/ });
  await expect(tag).toBeVisible();
  await page.waitForTimeout(200);
  await page.keyboard.press("Enter");
  await expect
    .poll(() => noteText(note))
    .toMatch(/\n- \[ \] Call Sam #work ?$/);
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
  const projectCapture = page.getByRole("textbox", {
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
  await expect(page.getByRole("region", { name: "Attachments" })).toBeVisible();
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

test("a status and a custom field added in Settings reach the task editor", async ({
  page,
}) => {
  await page.goto("?demo=24");
  await expect(page.locator(".task-row-title").first()).toBeVisible();
  await openNavigationItem(page, "Settings");
  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByText("Collection behavior", { exact: true })
    .click();

  await page.getByRole("button", { name: "Add status", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Status name" }).last(),
  ).toBeFocused();
  await page.keyboard.type("Waiting on reply");
  await page.getByRole("button", { name: "Add field", exact: true }).click();
  // The new row takes focus a frame later; a key before then is a shortcut.
  await expect(
    page.getByRole("textbox", { name: "Field name" }).last(),
  ).toBeFocused();
  await page.keyboard.type("Client");
  // A status without a name is refused in plain words, before anything is saved.
  await page.getByRole("button", { name: "Add priority", exact: true }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Give every priority a name.",
  );
  await expect(
    page.getByRole("textbox", { name: "Priority name" }).last(),
  ).toBeFocused();
  await page.keyboard.type("Someday");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved with the collection.")).toBeVisible();

  await page.getByRole("button", { name: /^Today\b/ }).click();
  await page.locator(".task-row-title").first().click();
  const pane = page.getByRole("complementary", {
    name: "Task details",
    exact: true,
  });
  await pane.getByRole("combobox", { name: "Status", exact: true }).click();
  await page.getByRole("option", { name: "Waiting on reply" }).click();
  await expect(
    pane.getByRole("combobox", { name: "Status", exact: true }),
  ).toContainText("Waiting on reply");
  await pane.getByRole("combobox", { name: "Priority", exact: true }).click();
  await expect(page.getByRole("option", { name: "Someday" })).toBeVisible();
  await page.keyboard.press("Escape");
  await pane.getByRole("button", { name: "Add property", exact: true }).click();
  await expect(
    page.getByRole("menuitem", { name: "Client", exact: true }),
  ).toBeVisible();
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
  // Leaving the notes field shows them as read; the draft is still there.
  await expect(page.locator(".notes-field")).toContainText(
    "Unsaved draft body",
  );
});
