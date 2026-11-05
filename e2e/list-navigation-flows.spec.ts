import { expect, test } from "./local-test";

const workBoard = `views/${encodeURIComponent("TaskNotes/Views/work-board.base#work-board")}?demo=60`;

test.beforeEach(async ({ page }) => {
  await page.goto("?demo=60&many-options");
  await expect(page.locator(".task-row").first()).toBeVisible();
});

test("overdue leads, accepts another date, and restores its dates with Undo", async ({
  page,
}) => {
  await expect(page.locator(".task-section-toggle").first()).toContainText(
    "Overdue",
  );
  await page.getByRole("button", { name: "Choose date", exact: true }).click();
  const date = new Date();
  date.setDate(date.getDate() + 4);
  const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  await page.getByText("Date options", { exact: true }).click();
  await page.getByLabel("Type a date").fill(value);
  await expect(page.locator(".task-date-hint")).toContainText("Enter to set");
  await page.getByLabel("Type a date").press("Enter");
  await page.getByRole("button", { name: "Move due dates too" }).click();
  const label = new Intl.DateTimeFormat("en", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(date);
  await expect(page.locator(".undo-toast")).toContainText(`to ${label}`);
  await expect(page.locator(".undo-toast")).toContainText("deadline");
  await page
    .locator(".undo-toast")
    .getByRole("button", { name: "Undo", exact: true })
    .click();
  await expect(page.locator(".task-section-toggle").first()).toContainText(
    "Overdue",
  );
});

test("completion shortcut undo clears its toast and restores row focus", async ({
  page,
}) => {
  const title = page.locator(".task-row-title").first();
  const label = (await title.textContent())!.trim();
  await title.focus();
  await page.keyboard.press("x");
  await expect(page.locator(".task-completed-notice")).toContainText(
    `Completed “${label}”`,
  );
  await expect(
    page.getByRole("button", { name: label, exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".task-completed-notice")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: label, exact: true }),
  ).toBeFocused();
});

test("extended selection keeps the focused row above the bulk bar", async ({
  page,
  isMobile,
}) => {
  await page.locator(".task-row-title").first().focus();
  for (let index = 0; index < 14; index++) await page.keyboard.press("Shift+j");
  const bar = page.locator(".bulk-actions");
  await expect(bar).toBeVisible();
  await expect
    .poll(async () => {
      const row = await page
        .locator(".task-row:has(.task-row-title:focus)")
        .boundingBox();
      const bounds = await bar.boundingBox();
      return Boolean(row && bounds && row.y + row.height <= bounds.y);
    })
    .toBe(true);
  await expect(
    bar.getByRole("combobox", { name: "Move selected tasks to project" }),
  ).toBeVisible();
  if (!isMobile)
    expect(
      await bar
        .getByRole("combobox", { name: "Move selected tasks to project" })
        .locator("span")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
});

test("Inbox lists only undated work and retains a count", async ({
  page,
  isMobile,
}) => {
  if (isMobile)
    await page.getByRole("button", { name: "More", exact: true }).click();
  await page
    .getByRole(isMobile ? "menuitem" : "button", { name: /^Inbox/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Inbox", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".task-row").first()).toBeVisible();
  await expect(
    page.locator(".task-row-property").filter({ hasText: /Scheduled|Due/ }),
  ).toHaveCount(0);
});

test("shortcut sheet uses its width and fits desktop without scrolling", async ({
  page,
  isMobile,
}) => {
  test.skip(
    isMobile,
    "Touch devices use the responsive sheet without keyboard shortcuts",
  );
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.keyboard.press("?");
  const sheet = page.locator(".keyboard-shortcuts-sheet");
  await expect(sheet).toBeVisible();
  expect(
    await sheet.evaluate(
      (element) => element.scrollHeight <= element.clientHeight + 1,
    ),
  ).toBe(true);
  const primary = await sheet.locator(".task-shortcuts-primary").boundingBox();
  const bounds = await sheet.boundingBox();
  expect(primary!.x - bounds!.x).toBeLessThan(40);
});

test("sidebar footer stays pinned and project navigation leaves no rail offset", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "Desktop sidebar only");
  await page.setViewportSize({ width: 1280, height: 800 });
  const settings = page
    .locator("aside")
    .getByRole("button", { name: "Settings", exact: true });
  const bounds = await settings.boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(800);
  await page.locator(".navigation-project-section button").first().click();
  await expect(
    page.getByRole("heading", { name: "Projects", exact: true }),
  ).toBeVisible();
  expect(
    await page.locator("aside").evaluate((element) => element.scrollTop),
  ).toBe(0);
});

test("desktop project metadata shares a fixed right anchor", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "Phones retain wrapping metadata");
  await page.setViewportSize({ width: 1280, height: 800 });
  const edges = await page
    .locator(".task-row .is-project")
    .evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().right),
    );
  expect(edges.length).toBeGreaterThan(2);
  expect(Math.max(...edges) - Math.min(...edges)).toBeLessThan(2);
  const capture = page.getByRole("combobox", { name: "New task title" });
  await expect(capture).toHaveAttribute("spellcheck", "false");
});

test("list visual checks at desktop and phone sizes in both themes", async ({
  page,
}, testInfo) => {
  for (const size of [
    { width: 1280, height: 800 },
    { width: 412, height: 915 },
  ]) {
    await page.setViewportSize(size);
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await testInfo.attach(`lists-${size.width}-${colorScheme}`, {
        body: await page.screenshot(),
        contentType: "image/png",
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    }
  }
});

test("list destinations share a content column", async ({ page, isMobile }) => {
  test.skip(isMobile, "Desktop reading measure");
  await page.setViewportSize({ width: 1280, height: 800 });
  const columns: Array<{ x: number; width: number }> = [];
  for (const name of [
    "Today",
    "Upcoming",
    "Projects",
    "Inbox",
    "Search",
    "Archive",
  ]) {
    await page
      .locator("aside")
      .getByRole("button", { name: new RegExp(`^${name}(?:,|$)`) })
      .click();
    await expect(
      page.getByRole("heading", { level: 1, name, exact: true }),
    ).toBeVisible();
    const column = await page.locator("main > .screen").boundingBox();
    columns.push({ x: column!.x, width: column!.width });
  }
  for (const column of columns) expect(column).toEqual(columns[0]);
});

test("long project and priority labels keep their metadata lanes", async ({
  page,
  isMobile,
}) => {
  await page.locator(".task-row .is-project strong").evaluateAll((elements) => {
    for (const element of elements)
      element.textContent =
        "A very long project name for the cross-functional international delivery programme";
  });
  await page
    .locator('.task-row-property[aria-label^="Priority:"] strong')
    .evaluateAll((elements) => {
      for (const element of elements)
        element.textContent =
          "Custom priority needing a deliberately very long label";
    });
  const metadata = await page
    .locator(".task-row-properties:has(.is-project)")
    .evaluateAll((elements) =>
      elements.map((element) => {
        const project = element
          .querySelector(".is-project")!
          .getBoundingClientRect();
        const bounds = element.getBoundingClientRect();
        const details = [...element.children]
          .filter((child) => !child.classList.contains("is-project"))
          .map((child) => child.getBoundingClientRect());
        return {
          projectRight: project.right,
          projectLeft: project.left,
          boundsRight: bounds.right,
          detailsRight: Math.max(0, ...details.map((detail) => detail.right)),
        };
      }),
    );
  expect(metadata.length).toBeGreaterThan(2);
  for (const row of metadata) {
    expect(row.projectRight).toBeLessThanOrEqual(row.boundsRight + 1);
    if (!isMobile) {
      expect(row.projectRight).toBeCloseTo(row.boundsRight, 0);
      expect(row.detailsRight).toBeLessThanOrEqual(row.projectLeft);
    }
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("a board move confirms with Undo and restores the card", async ({
  page,
}) => {
  await page.goto(workBoard);
  const columns = page.locator(".kanban-column");
  const card = columns.nth(1).locator("[data-kanban-card-id]").first();
  const id = (await card.getAttribute("data-kanban-card-id"))!;
  await card.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".undo-toast")).toContainText("In progress");
  await expect(
    columns.nth(1).locator(`[data-kanban-card-id="${id}"]`),
  ).toHaveCount(0);
  await page
    .locator(".undo-toast")
    .getByRole("button", { name: "Undo", exact: true })
    .click();
  await expect(
    columns.nth(1).locator(`[data-kanban-card-id="${id}"]`),
  ).toBeVisible();
});

test("the phone board fills the screen", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 686 });
  await page.goto(workBoard);
  await expect(page.locator(".kanban-card").first()).toBeVisible();
  const board = (await page.locator(".kanban-board").boundingBox())!;
  const navigation = (await page.locator(".bottom-navigation").boundingBox())!;
  expect(Math.abs(board.y + board.height - navigation.y)).toBeLessThanOrEqual(
    1,
  );
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(
    686,
  );
});

test("project shortcuts stay reachable in a short window", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 620 });
  const project = page.locator(".navigation-project-section button").last();
  await project.scrollIntoViewIfNeeded();
  const box = (await project.boundingBox())!;
  const manage = (await page.locator(".navigation-utility").boundingBox())!;
  expect(box.height).toBeGreaterThan(30);
  expect(box.y + box.height).toBeLessThanOrEqual(manage.y);
  expect(manage.y + manage.height).toBeLessThanOrEqual(620);
});

test("the task menu starts on the current priority and filters by name", async ({
  page,
}) => {
  await page.locator("body").press("j");
  await page.keyboard.press("p");
  await expect(
    page.locator(".task-actions-items [role='menuitemradio']").first(),
  ).toBeVisible();
  const pressed = page.locator(
    ".task-actions-items [role='menuitemradio'][aria-checked='true']",
  );
  const filter = page.getByRole("combobox", { name: "Filter Priority" });
  await expect(filter).toBeFocused();
  await expect(pressed).toHaveClass(/is-active/);
  await expect(filter).toHaveAttribute(
    "aria-activedescendant",
    await pressed.getAttribute("id"),
  );
  const other = page.getByRole("menuitemradio").last();
  const label = (await other.innerText()).trim();
  await filter.fill(label);
  await expect(page.getByRole("menuitemradio")).toHaveCount(1);
  await expect(page.getByRole("menuitemradio")).toHaveText(label);
  await filter.press("Enter");
  await expect(filter).toHaveCount(0);
});

test("a task's circle selects rather than completes while selecting", async ({
  page,
}) => {
  await page.goto("?demo=60");
  await page
    .getByRole("button", { name: /Select tasks/ })
    .first()
    .click();
  const row = page.locator(".task-row").first();
  const title = await row.locator(".task-row-title").textContent();
  await row.locator(".completion-control").click();
  await expect(page.locator(".bulk-actions")).toContainText("1 selected");
  await page.getByRole("button", { name: `Deselect ${title}` }).click();
  await expect(page.locator(".bulk-actions")).toContainText("0 selected");
  await expect(row).toContainText(title!);
  await expect(row).not.toHaveClass(/is-complete/);
});

test("a known project with spaces is typed by its plain name", async ({
  isMobile,
  page,
}) => {
  test.skip(isMobile, "Phones capture from the Add task sheet.");
  await page.goto("?demo=60");
  await page
    .locator(".quick-capture textarea")
    .first()
    .fill("Call dentist +Product refresh");
  await expect(
    page.locator(".capture-token").filter({ hasText: "+Product refresh" }),
  ).toBeVisible();
});

test("a sidebar project opens as its own page and returns to all projects", async ({
  isMobile,
  page,
}) => {
  test.skip(isMobile, "The sidebar is a desktop surface.");
  await page.goto("?demo=60");
  const shortcut = page
    .getByRole("group", { name: "Busiest projects" })
    .getByRole("button", { name: /Operations/ });
  await shortcut.click();
  await expect(page.locator(".project-group")).toHaveCount(1);
  await expect(shortcut).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "All projects" }).click();
  await expect(page.locator(".project-group").nth(1)).toBeVisible();
  await expect(shortcut).not.toHaveAttribute("aria-current", "page");
});

test("stepping through tasks moves the open row and Escape returns to it", async ({
  isMobile,
  page,
}) => {
  test.skip(isMobile, "Phones show one task at a time.");
  await page.goto("?demo=60");
  await page.locator(".task-row-title").first().click();
  await expect(page.locator(".task-row.is-open")).toHaveCount(1);
  await expect(
    page
      .locator(".detail-inspector h1, .detail-inspector .title-field")
      .first(),
  ).toBeVisible();
  await page.keyboard.press("j");
  const second = page.locator(".task-row[data-task-id]").nth(1);
  await expect(second).toHaveClass(/is-open/);
  const title = await second.getAttribute("data-task-title");
  await expect(
    page.locator(".detail-inspector").getByText(title ?? ""),
  ).not.toHaveCount(0);
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
  await expect(second.locator(".task-row-title")).toBeFocused();
});

test("Today and Upcoming agree on what is overdue", async ({ page }) => {
  await page.goto("?demo=60");
  const overdue = page.locator(".task-section.is-overdue .task-row");
  await expect(overdue.first()).toBeVisible();
  const today = await overdue.count();
  await page.goto(
    `views/${encodeURIComponent("TaskNotes/Views/upcoming.base#upcoming")}?demo=60`,
  );
  await expect(page.locator(".tnc-list-lead .task-row")).toHaveCount(today);
});

test("one Escape closes the project picker and returns to the row", async ({
  isMobile,
  page,
}) => {
  test.skip(isMobile, "Phones move a task from its menu.");
  await page.goto("?demo=60");
  const title = page.locator(".task-row-title").first();
  await title.focus();
  await page.keyboard.press("+");
  await expect(page.getByPlaceholder("Find a project")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByPlaceholder("Find a project")).toHaveCount(0);
});

test("a click on an Upcoming day heading stays where it is", async ({
  isMobile,
  page,
}) => {
  test.skip(isMobile, "Phones browse days by tapping them.");
  await page.goto(
    `views/${encodeURIComponent("TaskNotes/Views/upcoming.base#upcoming")}?demo=60`,
  );
  const heading = page.locator(".tnc-list-section .tnc-list-day").nth(1);
  await heading.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const before = await page.evaluate(() => window.scrollY);
  await heading.click({ position: { x: 400, y: 10 } });
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
});

test("long status and priority lists keep the keyboard's place in view", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Keyboard path.");
  await page.locator(".task-row-title").first().click();
  for (const name of ["Status", "Priority"]) {
    const trigger = page.getByRole("combobox", { name, exact: true }).first();
    await trigger.focus();
    await trigger.press("Enter");
    const list = page.locator(".tasknotes-select-popover[data-state='open']");
    const options = list.getByRole("option");
    await expect(options).toHaveCount(12);
    const filter = list.getByRole("combobox");
    await expect(filter).toBeFocused();
    const active = list.locator("button.is-active");
    await expect(active).toBeInViewport({ ratio: 1 });

    await filter.press("End");
    await expect(active).toHaveText((await options.last().innerText()).trim());
    await expect(filter).toHaveAttribute(
      "aria-activedescendant",
      await options.last().getAttribute("id"),
    );
    await expect(active).toBeInViewport({ ratio: 1 });
    await expect(options.last()).toHaveClass(/is-active/);
    expect(
      await list.locator(".tasknotes-option-list").evaluate((scroller) => {
        const bounds = scroller.getBoundingClientRect();
        const row = scroller.lastElementChild!.getBoundingClientRect();
        return row.bottom <= bounds.bottom + 1;
      }),
    ).toBe(true);

    await filter.press("Home");
    await expect(options.first()).toHaveClass(/is-active/);
    expect(
      await list
        .locator(".tasknotes-option-list")
        .evaluate((scroller) => scroller.scrollTop),
    ).toBe(0);

    for (let step = 0; step < 11; step += 1) await filter.press("ArrowDown");
    await expect(options.last()).toHaveClass(/is-active/);
    await filter.press("ArrowUp");
    await expect(options.nth(10)).toHaveClass(/is-active/);
    await expect(active).toBeInViewport({ ratio: 1 });

    await filter.press("Escape");
    await expect(list).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await trigger.press("Enter");
    await filter.press("End");
    await filter.press("Enter");
    await expect(list).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.press("Enter");
    await expect(options.last()).toHaveClass(/is-active/);
    await expect(active).toBeInViewport({ ratio: 1 });
    await filter.press("Escape");
  }
});

test("typing filters a long option list and keeps its active match visible", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Keyboard path.");
  await page.locator(".task-row-title").first().click();
  const trigger = page
    .getByRole("combobox", { name: "Status", exact: true })
    .first();
  await trigger.focus();
  await trigger.press("Enter");
  const list = page.locator(".tasknotes-select-popover[data-state='open']");
  const label = (await list.getByRole("option").nth(9).innerText()).trim();
  const filter = list.getByRole("combobox");
  await expect(filter).toBeFocused();
  await filter.fill(label);
  await expect(list.getByRole("option")).toHaveCount(1);
  await expect(list.locator("button.is-active")).toHaveText(label);
  await expect(list.locator("button.is-active")).toBeInViewport({ ratio: 1 });
  await filter.press("Escape");
});

test("a board's columns fit a laptop width before it scrolls", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop board.");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(workBoard);
  await expect(page.locator(".kanban-column")).toHaveCount(4);
  const overflow = await page
    .locator(".kanban-board")
    .evaluate((board) => board.scrollWidth - board.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("only a missed deadline turns a row's date red", async ({ page }) => {
  const rows = page.locator(".task-row");
  await expect(
    rows
      .filter({ hasText: "Prepare quarterly planning session" })
      .locator(".is-overdue"),
  ).toHaveCount(1);
  await expect(
    rows.filter({ hasText: "Book the project room" }).locator(".is-overdue"),
  ).toHaveCount(0);
});

test("s opens status from a row and the palette offers it", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Keyboard path.");
  await page.keyboard.press("j");
  await page.keyboard.press("s");
  await expect(page.getByRole("menuitemradio").first()).toBeVisible();
  await expect(page.locator(".task-actions-items")).toContainText("Triage");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+k");
  await page.keyboard.type("status");
  await expect(page.getByRole("option", { name: /Set status/ })).toBeVisible();
});

test("a board opened from Views fills the phone without a spare gutter", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Phone layout.");
  await page.goto(workBoard);
  await expect(page.locator(".kanban-column").first()).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollHeight - window.innerHeight,
      ),
    )
    .toBeLessThanOrEqual(0);
});
