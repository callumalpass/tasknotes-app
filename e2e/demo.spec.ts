import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

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
  await currentScratchpad.getByRole("button", { name: "Markdown" }).click();
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

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByText("TaskNotes demo")).toBeVisible();
  await expect(page.getByText("50 total")).toBeVisible();
  await expect(page).toHaveURL(/\/more\?demo=50/);
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
  await expect(current.locator("input:focus")).toHaveCount(1);
  const feed = page.locator(".scratchpad-history-scroll");
  await expect
    .poll(() =>
      feed.evaluate(
        (element) =>
          element.scrollHeight - element.clientHeight - element.scrollTop,
      ),
    )
    .toBeLessThanOrEqual(2);
  const currentBottomGap = () =>
    feed.evaluate((element) => {
      const currentDocument = element.querySelector(
        ".scratchpad-current-document",
      );
      if (!currentDocument) return Number.POSITIVE_INFINITY;
      return (
        element.getBoundingClientRect().bottom -
        currentDocument.getBoundingClientRect().bottom
      );
    });
  await expect.poll(currentBottomGap).toBeGreaterThanOrEqual(22);
  await expect.poll(currentBottomGap).toBeLessThanOrEqual(28);
  await current
    .getByRole("button", { name: "Actions for empty item" })
    .last()
    .click();
  await expect(current.getByRole("menu", { name: /Actions for/ })).toHaveClass(
    /opens-up/,
  );
  await page.keyboard.press("Escape");
  await current.getByRole("button", { name: "Markdown" }).click();
  await expect(
    current.getByRole("textbox", { name: "Scratchpad Markdown" }),
  ).toBeFocused();
  await expect.poll(currentBottomGap).toBeGreaterThanOrEqual(22);
  await expect.poll(currentBottomGap).toBeLessThanOrEqual(28);
  for (let index = 0; index < 3; index += 1) {
    await current.getByRole("button", { name: "Outline" }).click();
    await expect(
      current.getByRole("tree", { name: "Scratchpad outline" }),
    ).toBeVisible();
    await expect.poll(currentBottomGap).toBeGreaterThanOrEqual(22);
    await expect.poll(currentBottomGap).toBeLessThanOrEqual(28);
    await current.getByRole("button", { name: "Markdown" }).click();
    await expect(
      current.getByRole("textbox", { name: "Scratchpad Markdown" }),
    ).toBeFocused();
    await expect.poll(currentBottomGap).toBeGreaterThanOrEqual(22);
    await expect.poll(currentBottomGap).toBeLessThanOrEqual(28);
  }
});

test("uses dark theme tokens throughout the Scratchpad editor", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("mdbase:theme", "dark"));
  await page.goto("scratchpad/?demo=12");

  const current = page.getByRole("region", {
    name: "Editor for current scratchpad",
  });
  await expect(current).toBeVisible();

  const outlineButton = current.getByRole("button", { name: "Outline" });
  const markdownButton = current.getByRole("button", { name: "Markdown" });
  await expect(outlineButton).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() =>
      markdownButton.evaluate(
        (button) => getComputedStyle(button).backgroundColor,
      ),
    )
    .toBe("rgba(0, 0, 0, 0)");

  const cardShadowUsesThemeToken = await page
    .locator(".scratchpad-current-document")
    .evaluate((card) => {
      const probe = document.createElement("div");
      probe.style.boxShadow = "0 8px 28px var(--color-shadow-soft)";
      document.body.append(probe);
      const expected = getComputedStyle(probe).boxShadow;
      probe.remove();
      return getComputedStyle(card).boxShadow === expected;
    });
  expect(cardShadowUsesThemeToken).toBe(true);

  await markdownButton.click();
  const editor = current.getByRole("textbox", { name: "Scratchpad Markdown" });
  await expect(editor).toBeFocused();

  const editorTheme = await current.evaluate((region) => {
    const activeLine = region.querySelector<HTMLElement>(".cm-activeLine")!;
    const punctuation = region.querySelector<HTMLElement>(".cm-line span")!;
    const codeMirror = region.querySelector<HTMLElement>(".cm-editor")!;
    const probe = document.createElement("div");
    probe.style.color = "var(--ink-muted)";
    probe.style.backgroundColor =
      "color-mix(in srgb, var(--accent-soft) 52%, transparent)";
    document.body.append(probe);
    const expectedPunctuation = getComputedStyle(probe).color;
    const expectedActiveLine = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return {
      punctuationUsesMutedInk:
        getComputedStyle(punctuation).color === expectedPunctuation,
      activeLineUsesSoftAccent:
        getComputedStyle(activeLine).backgroundColor === expectedActiveLine,
      focusIsVisible: getComputedStyle(codeMirror).boxShadow !== "none",
    };
  });
  expect(editorTheme).toEqual({
    punctuationUsesMutedInk: true,
    activeLineUsesSoftAccent: true,
    focusIsVisible: true,
  });
});

test("keeps an embedded demo inside its frameable route", async ({ page }) => {
  await page.goto("embed/?demo=12");

  await expect(
    page.getByRole("heading", { level: 1, name: "Today", exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Scratchpad", exact: true }).click();
  await expect(page).toHaveURL(/\/embed\/scratchpad\?demo=12/);
  await expect(
    page.getByRole("heading", { name: "Scratchpad", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "New note" })).toBeVisible();
  await expect(page.getByText("Image file is unavailable")).toBeVisible();
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
  await expect(page.getByText("Draft the interview guide")).toBeVisible();

  await openNavigationItem(page, "Manage views");
  await page.getByRole("button", { name: "Edit Today" }).click();
  const viewName = page.getByRole("textbox", { name: "View name" });
  await viewName.fill("Daily focus");
  await page.getByRole("button", { name: "Save view" }).click();
  await expect(
    page.getByRole("button", { name: "Daily focus", exact: true }),
  ).toBeVisible();
});

async function openNavigationItem(page: Page, name: string): Promise<void> {
  const direct = page.getByRole("button", { name, exact: true });
  if (await direct.isVisible()) {
    await direct.click();
    return;
  }
  await page.getByRole("button", { name: "Views", exact: true }).click();
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

  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByText("Task model", { exact: true }).click();
  await page.getByRole("combobox", { name: "Default priority" }).click();
  await page.getByRole("option", { name: "High", exact: true }).click();
  await page.getByRole("button", { name: "Save task settings" }).click();
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
