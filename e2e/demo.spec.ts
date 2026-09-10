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
  await expect
    .poll(() =>
      page
        .locator(".scratchpad-screen")
        .evaluate((element) => getComputedStyle(element).paddingTop),
    )
    .toBe("0px");
  const current = page.getByRole("region", {
    name: "Editor for current scratchpad",
  });
  await expect(current.locator("[data-scratch-input]:focus")).toHaveCount(1);
  const feed = page.locator(".scratchpad-history-scroll");
  await expect
    .poll(() =>
      feed.evaluate(
        (element) =>
          element.scrollHeight - element.clientHeight - element.scrollTop,
      ),
    )
    .toBeLessThanOrEqual(2);
  const currentPlacementOffset = () =>
    feed.evaluate((element) => {
      const currentDocument = element.querySelector(
        ".scratchpad-current-document",
      );
      if (!currentDocument) return Number.POSITIVE_INFINITY;
      const scrollerBounds = element.getBoundingClientRect();
      const cardBounds = currentDocument.getBoundingClientRect();
      const bottomGutter = Number.parseFloat(
        getComputedStyle(element).paddingBottom,
      );
      const expectedGap =
        window.innerWidth <= 560
          ? bottomGutter
          : Math.max(
              bottomGutter,
              (element.clientHeight - cardBounds.height) / 2,
            );
      const actualGap = scrollerBounds.bottom - cardBounds.bottom;
      return Math.abs(actualGap - expectedGap);
    });
  await expect.poll(currentPlacementOffset).toBeLessThanOrEqual(2);
  await current
    .getByRole("button", { name: "Actions for empty item" })
    .last()
    .click();
  await expect(current.getByRole("menu", { name: /Actions for/ })).toHaveClass(
    /opens-up/,
  );
  await page.keyboard.press("Escape");
  await current.getByRole("button", { name: "Write" }).click();
  await expect(
    current.getByRole("textbox", { name: "Scratchpad Markdown" }),
  ).toBeFocused();
  await expect.poll(currentPlacementOffset).toBeLessThanOrEqual(2);
  for (let index = 0; index < 3; index += 1) {
    await current.getByRole("button", { name: "Outline" }).click();
    await expect(
      current.getByRole("tree", { name: "Scratchpad outline" }),
    ).toBeVisible();
    await expect.poll(currentPlacementOffset).toBeLessThanOrEqual(2);
    await current.getByRole("button", { name: "Write" }).click();
    await expect(
      current.getByRole("textbox", { name: "Scratchpad Markdown" }),
    ).toBeFocused();
    await expect.poll(currentPlacementOffset).toBeLessThanOrEqual(2);
  }
});

test("bottom-anchors the current Scratchpad above an overlay keyboard", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const viewport = new EventTarget() as VisualViewport;
    Object.defineProperties(viewport, {
      height: { configurable: true, writable: true, value: 844 },
      offsetTop: { configurable: true, writable: true, value: 0 },
    });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: viewport,
    });
    Object.defineProperty(window, "setTestVisualViewport", {
      configurable: true,
      value: (height: number, offsetTop = 0) => {
        Object.defineProperties(viewport, {
          height: { configurable: true, writable: true, value: height },
          offsetTop: { configurable: true, writable: true, value: offsetTop },
        });
        viewport.dispatchEvent(new Event("resize"));
      },
    });
  });
  await page.goto("scratchpad/?demo=12");
  const feed = page.locator(".scratchpad-history-scroll");
  const current = page.locator(".scratchpad-current-document");
  const restSpace = page.locator(".scratchpad-current-rest-space");
  const capture = current.getByRole("textbox", { name: "Draft task: empty" });
  await expect(current).toBeVisible();
  await expect(capture).toBeFocused();
  await expect(restSpace).toHaveCSS("display", "none");

  const currentBottomOffset = () =>
    feed.evaluate((element) => {
      const currentDocument = element.querySelector(
        ".scratchpad-current-document",
      );
      if (!currentDocument) return Number.POSITIVE_INFINITY;
      const actualGap =
        element.getBoundingClientRect().bottom -
        currentDocument.getBoundingClientRect().bottom;
      const expectedGap = Number.parseFloat(
        getComputedStyle(element).paddingBottom,
      );
      return Math.abs(actualGap - expectedGap);
    });

  await expect.poll(currentBottomOffset).toBeLessThanOrEqual(2);
  await page.evaluate(() => {
    (
      window as typeof window & {
        setTestVisualViewport(height: number, offsetTop?: number): void;
      }
    ).setTestVisualViewport(520);
  });
  await expect.poll(currentBottomOffset).toBeLessThanOrEqual(2);
  await expect
    .poll(() =>
      page
        .locator(".scratchpad-screen")
        .evaluate((element) => element.getBoundingClientRect().bottom),
    )
    .toBeLessThanOrEqual(520);
  await expect(capture).toBeFocused();
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

test("moves the centered current Scratchpad down after an intentional upward scroll", async ({
  page,
}) => {
  await page.goto("scratchpad/?demo=12");
  const feed = page.locator(".scratchpad-history-scroll");
  const current = page.locator(".scratchpad-current-document");
  await expect(current).toBeVisible();
  const initialTop = await current.evaluate(
    (element) => element.getBoundingClientRect().top,
  );

  await feed.hover();
  await page.mouse.wheel(0, -160);

  await expect
    .poll(() =>
      current.evaluate((element) => element.getBoundingClientRect().top),
    )
    .toBeGreaterThan(initialTop + 80);
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
  if ((page.viewportSize()?.width ?? 1000) <= 560) {
    await current
      .getByRole("button", {
        name: "Actions for Continue after conversion",
        exact: true,
      })
      .click();
    await current
      .getByRole("menuitem", { name: "Create task", exact: true })
      .click();
  } else {
    await current
      .getByRole("button", {
        name: "Create task for Continue after conversion",
        exact: true,
      })
      .click();
  }
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

test("wraps outline text without splitting nodes or scrolling horizontally", async ({
  page,
}) => {
  await page.goto("scratchpad/?demo=12");
  const current = page.getByRole("region", {
    name: "Editor for current scratchpad",
  });
  const input = current.locator("[data-scratch-input]").last();
  const text =
    "A longer thought that should wrap naturally within its outline row. "
      .repeat(8)
      .trim();
  await input.fill(text);
  await expect(input).toHaveValue(text);
  const dimensions = await input.evaluate((element) => ({
    height: element.clientHeight,
    scrollHeight: element.scrollHeight,
    width: element.clientWidth,
    scrollWidth: element.scrollWidth,
    lineHeight: parseFloat(getComputedStyle(element).lineHeight),
  }));
  expect(dimensions.height).toBeGreaterThan(dimensions.lineHeight * 2);
  expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.height + 1);
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width + 1);
  const count = await current.locator("[data-scratch-row]").count();
  await input.press("End");
  await input.press("Enter");
  await expect(current.locator("[data-scratch-row]")).toHaveCount(count + 1);
  await expect(current.locator("[data-scratch-input]").last()).toBeFocused();
});

test("configures the default mode for new Scratchpad notes", async ({
  page,
}) => {
  await page.goto("more/?demo=12");
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

test("offers a quiet writing surface with selection-preserving tools", async ({
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
  await expect(current.getByRole("status")).toHaveText("Saved");
  await expect(current.getByRole("status")).toBeVisible();
  await source.press("ControlOrMeta+z");
  await expect(source).toHaveText("A thought worth keeping");
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
  const outlineLabel = await outlineOption.locator("span").boundingBox();
  const outlinePath = await outlineOption.locator("small").boundingBox();
  expect(outlinePath?.y).toBeGreaterThan(outlineLabel?.y ?? Infinity);
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
  await expect(source).toContainText(
    /- \[\[tasks\/.*\|Prepare quarterly planning session\]\]/,
  );
  await expect(source).not.toContainText(
    /\[ \] \[\[tasks\/.*\|Prepare quarterly planning session\]\]/,
  );
  await source.fill("[[quarterly");
  const markdownOption = current.getByRole("option", {
    name: /Prepare quarterly planning session/,
  });
  await expect(markdownOption).toBeVisible();
  await expect(markdownOption.locator(".cm-completionIcon")).toBeHidden();
  const markdownLabel = await markdownOption
    .locator(".cm-completionLabel")
    .boundingBox();
  const markdownPath = await markdownOption
    .locator(".cm-completionDetail")
    .boundingBox();
  expect(markdownPath?.y).toBeGreaterThan(markdownLabel?.y ?? Infinity);
  await markdownOption.click();
  await expect(source).toHaveText(
    /\[\[tasks\/.*\|Prepare quarterly planning session\]\]/,
  );
});

test("presents recognized outline details as quiet aligned metadata", async ({
  page,
}) => {
  await page.goto("scratchpad/?demo=12");

  const current = page.getByRole("region", {
    name: "Editor for current scratchpad",
  });
  const input = current
    .getByRole("textbox", { name: "Draft task: empty" })
    .last();
  await input.fill("Call Alex tomorrow at 3pm !high please");

  const preview = current.getByLabel("Recognized task details");
  await expect(preview).toHaveAttribute("aria-live", "polite");
  await expect(preview.locator("span")).toHaveCount(2);
  const presentation = await preview.evaluate((element) => {
    const details = element.firstElementChild as HTMLElement;
    const firstItem = details.firstElementChild as HTMLElement;
    const input = element.previousElementSibling?.querySelector(
      "[data-scratch-input]",
    );
    const detailBounds = details.getBoundingClientRect();
    const inputBounds = input?.getBoundingClientRect();
    const itemStyle = getComputedStyle(firstItem);
    const rootStyle = getComputedStyle(document.documentElement);
    const probe = document.createElement("span");
    probe.style.color = rootStyle.getPropertyValue("--ink-muted");
    document.body.append(probe);
    const mutedColor = getComputedStyle(probe).color;
    probe.remove();
    return {
      alignedWithInput:
        Boolean(inputBounds) &&
        Math.abs(detailBounds.left - inputBounds!.left) <= 1,
      transparentItems: itemStyle.backgroundColor === "rgba(0, 0, 0, 0)",
      borderlessItems: itemStyle.borderTopWidth === "0px",
      usesMutedInk: itemStyle.color === mutedColor,
    };
  });
  expect(presentation).toEqual({
    alignedWithInput: true,
    transparentItems: true,
    borderlessItems: true,
    usesMutedInk: true,
  });
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
  const markdownButton = current.getByRole("button", { name: "Write" });
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

  await editor.fill("[[quarterly");
  const option = current.getByRole("option", {
    name: /Prepare quarterly planning session/,
  });
  await expect(option).toBeVisible();
  const pickerTheme = await option.evaluate((item) => {
    const tooltip = item.closest<HTMLElement>(".cm-tooltip-autocomplete")!;
    const detail = item.querySelector<HTMLElement>(".cm-completionDetail")!;
    const probe = document.createElement("div");
    probe.style.backgroundColor = "var(--paper-raised)";
    probe.style.borderColor = "var(--line-strong)";
    probe.style.color = "var(--ink-muted)";
    document.body.append(probe);
    const expected = getComputedStyle(probe);
    const values = {
      raisedSurface:
        getComputedStyle(tooltip).backgroundColor === expected.backgroundColor,
      strongBorder:
        getComputedStyle(tooltip).borderColor === expected.borderColor,
      mutedPath: getComputedStyle(detail).color === expected.color,
      selectedUsesAccent:
        getComputedStyle(item).backgroundColor !== "rgba(0, 0, 0, 0)",
      elevated: getComputedStyle(tooltip).boxShadow !== "none",
    };
    probe.remove();
    return values;
  });
  expect(pickerTheme).toEqual({
    raisedSurface: true,
    strongBorder: true,
    mutedPath: true,
    selectedUsesAccent: true,
    elevated: true,
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

test("keeps view management clear and scalable", async ({ page }) => {
  await page.goto("views/?demo=24");

  await expect(
    page.getByRole("heading", { name: "Manage views" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Choose what appears in navigation, change its order, and manage saved views.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Shown in navigation" }),
  ).toBeVisible();
  const allViews = page.getByRole("region", { name: "All views" });
  await expect(
    allViews.getByRole("searchbox", { name: "Search views" }),
  ).toBeVisible();
  await expect(allViews.getByText("TaskNotes tools")).toBeVisible();
  await expect(allViews.getByText("Saved views")).toBeVisible();
  await expect(allViews.getByText("TaskNotes/Views/today.base")).toBeVisible();
  const toolMembership = allViews.getByRole("button", {
    name: "Remove Scratchpad from navigation",
  });
  const savedMembership = allViews.getByRole("button", {
    name: "Remove Today from navigation",
  });
  const [toolMembershipBox, savedMembershipBox] = await Promise.all([
    toolMembership.boundingBox(),
    savedMembership.boundingBox(),
  ]);
  expect(toolMembershipBox).not.toBeNull();
  expect(savedMembershipBox).not.toBeNull();
  expect(
    Math.abs(
      toolMembershipBox!.x +
        toolMembershipBox!.width -
        (savedMembershipBox!.x + savedMembershipBox!.width),
    ),
  ).toBeLessThanOrEqual(1);
  const accessibility = await new AxeBuilder({ page })
    .include(".views-screen")
    .analyze();
  expect(
    accessibility.violations.filter(({ impact }) =>
      ["critical", "serious"].includes(impact ?? ""),
    ),
  ).toEqual([]);

  await allViews
    .getByRole("searchbox", { name: "Search views" })
    .fill("work board");
  await expect(allViews.getByRole("button", { name: "All 1" })).toBeVisible();
  await expect(allViews.getByText("Work board", { exact: true })).toBeVisible();
  await expect(allViews.getByText("Today", { exact: true })).toHaveCount(0);

  await allViews.getByRole("searchbox", { name: "Search views" }).fill("");
  const editableFilter = allViews.getByRole("button", { name: /Editable/ });
  await editableFilter.focus();
  await editableFilter.press("Enter");
  await expect(allViews.getByText("TaskNotes tools")).toHaveCount(0);
  await expect(allViews.getByText("Work board", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Reorder" }).click();
  const dragScratchpad = page.getByRole("button", {
    name: "Move Scratchpad. Drag, or use up and down arrow keys.",
  });
  const dragToday = page.getByRole("button", {
    name: "Move Today. Drag, or use up and down arrow keys.",
  });
  const [scratchpadBox, todayBox] = await Promise.all([
    dragScratchpad.boundingBox(),
    dragToday.boundingBox(),
  ]);
  expect(scratchpadBox).not.toBeNull();
  expect(todayBox).not.toBeNull();
  await page.mouse.move(
    scratchpadBox!.x + scratchpadBox!.width / 2,
    scratchpadBox!.y + scratchpadBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(todayBox!.x + todayBox!.width / 2, todayBox!.y + 4, {
    steps: 6,
  });
  await expect(dragScratchpad.locator("xpath=..")).toHaveClass(/is-dragging/);
  await expect(dragToday.locator("xpath=..")).toHaveClass(/is-drop-before/);
  await page.mouse.up();
  await expect(page.getByText(/Scratchpad moved before Today/)).toBeAttached();
  await page.getByRole("button", { name: "Done" }).click();
  await allViews.getByRole("button", { name: /^All / }).click();
  await allViews
    .getByRole("button", { name: /^Scratchpad/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/?demo=24$/);
  await expect(
    page.getByRole("heading", { name: "Scratchpad", exact: true }),
  ).toBeVisible();
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

  await openNavigationItem(page, "Manage views");
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
  await page.getByRole("button", { name: "Browse", exact: true }).click();
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
  await openNavigationItem(page, "Settings");
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
