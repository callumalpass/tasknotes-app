import { test, expect } from "./local-test";

for (const width of [1280, 390]) {
  test(`local capture survives a full page restart at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/e2e/local-first.fixture.html");
    await expect(
      page.getByRole("heading", { name: "Today", exact: true }),
    ).toBeVisible();
    const capture =
      width < 840
        ? page.locator(".view-context-capture")
        : page
            .getByRole("button", { name: "New task", exact: true })
            .filter({ visible: true });
    await capture.click();
    const dialog = page.getByRole("dialog", { name: "New task", exact: true });
    const title = dialog.getByRole("combobox", { name: "New task title" });
    await title.fill("Local persistence today !high");
    await title.press("Enter");
    await expect(dialog).toHaveCount(0);
    await expect(
      page.locator(".task-row-title").filter({ hasText: "Local persistence" }),
    ).toBeVisible();
    await page.goto("/e2e/local-first.fixture.html");
    const task = page
      .locator(".task-row-title")
      .filter({ hasText: "Local persistence" });
    await expect(task).toBeVisible();
    await task.click();
    const detailTitle = page.getByLabel("Task title", { exact: true });
    await expect(detailTitle).toHaveValue("Local persistence");
    await detailTitle.fill("Edited local persistence");
    await detailTitle.press("Tab");
    await expect(
      page.getByText("Saved", { exact: true }).filter({ visible: true }),
    ).toBeVisible();
    await page.goto("/e2e/local-first.fixture.html");
    await expect(
      page
        .locator(".task-row-title")
        .filter({ hasText: "Edited local persistence" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(`local-${width}.png`),
      fullPage: true,
    });
  });
}

test("opens the real SDK entry into local capture with account traffic blocked", async ({
  page,
}) => {
  await page.goto("/e2e/local-first.fixture.html?real-sdk");
  await expect(
    page.getByRole("heading", { name: "Today", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("button", { name: "Connect collection", exact: true })
      .filter({ visible: true }),
  ).toBeVisible();
});

test("keeps Scratchpad work when opening Connect and returning to the local collection", async ({
  page,
}) => {
  await page.goto("/e2e/local-first.fixture.html");
  await page
    .getByRole("button", { name: "Scratchpad", exact: true })
    .filter({ visible: true })
    .click();
  await page
    .getByRole("textbox", { name: "Draft task: empty", exact: true })
    .fill("Remember before connecting");
  await expect(
    page.getByText("Saved", { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Connect collection", exact: true })
    .filter({ visible: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Keep working locally", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Keep working locally", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Scratchpad", exact: true })
    .filter({ visible: true })
    .click();
  await expect(
    page.getByRole("textbox", {
      name: "Draft task: Remember before connecting",
      exact: true,
    }),
  ).toHaveValue("Remember before connecting");
  await page.goto("/e2e/local-first.fixture.html");
  await page
    .getByRole("button", { name: "Scratchpad", exact: true })
    .filter({ visible: true })
    .click();
  await expect(
    page.getByRole("textbox", {
      name: "Draft task: Remember before connecting",
      exact: true,
    }),
  ).toHaveValue("Remember before connecting");
});

test("local attachment bytes survive a full page restart", async ({ page }) => {
  await page.goto("/e2e/local-first.fixture.html");
  await page
    .getByRole("button", { name: "New task", exact: true })
    .filter({ visible: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "New task", exact: true });
  const title = dialog.getByRole("combobox", { name: "New task title" });
  await title.fill("Local attachment today");
  await title.press("Enter");
  await expect(dialog).toHaveCount(0);
  await page
    .locator(".task-row-title")
    .filter({ hasText: "Local attachment" })
    .click();
  const attachments = page.getByRole("region", {
    name: "Attachments",
    exact: true,
  });
  const bytes = Buffer.from([0, 1, 127, 128, 255, 10]);
  await attachments.getByLabel("Attach file", { exact: true }).setInputFiles({
    name: "local-bytes.txt",
    mimeType: "text/plain",
    buffer: bytes,
  });
  await expect(
    attachments.getByRole("button", {
      name: "Download local-bytes.txt",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Saved", { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  await page.goto("/e2e/local-first.fixture.html");
  await page
    .locator(".task-row-title")
    .filter({ hasText: "Local attachment" })
    .click();
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download local-bytes.txt", exact: true })
    .click();
  const stream = await (await downloaded).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks)).toEqual(bytes);
});

test("phone More names local work and leads to an honest Connect page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/e2e/local-first.fixture.html");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  const more = page.getByRole("button", { name: "More", exact: true });
  await more.click();
  const menu = page.getByRole("menu", { name: "More", exact: true });
  await expect(menu).toBeVisible();
  await expect
    .poll(async () => {
      const menuBounds = await menu.boundingBox();
      const triggerBounds = await more.boundingBox();
      return menuBounds!.y + menuBounds!.height <= triggerBounds!.y - 4;
    })
    .toBe(true);
  const local = page.getByRole("menuitem", { name: /Local tasks/ });
  await expect(local).toContainText("Saved in this browser");
  await local.click();
  await expect(page.getByText("Not connected", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Refresh now", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Connect collection", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Keep working locally", exact: true }),
  ).toBeVisible();
});

test("collapsed local navigation keeps connection controls compact and usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 844 });
  await page.goto("/e2e/local-first.fixture.html");
  const rail = page.getByRole("complementary", { name: "Primary" });
  const connect = rail.getByRole("button", {
    name: "Connect collection",
    exact: true,
  });
  const notice = rail.getByText(
    "Saved in this browser. Clearing browser data removes local tasks.",
    { exact: true },
  );
  await expect(notice).toBeVisible();
  await rail.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(notice).toBeHidden();
  await expect(connect).toHaveAccessibleDescription(
    "Saved in this browser. Clearing browser data removes local tasks.",
  );
  const railBounds = await rail.boundingBox();
  const connectBounds = await connect.boundingBox();
  expect(railBounds!.width).toBe(72);
  expect(connectBounds!.height).toBe(44);
  expect(connectBounds!.x).toBeGreaterThanOrEqual(railBounds!.x);
  expect(connectBounds!.x + connectBounds!.width).toBeLessThanOrEqual(
    railBounds!.x + railBounds!.width,
  );
  await expect(connect.locator("span")).toBeHidden();
  await connect.focus();
  await page.keyboard.press("Enter");
  await page
    .getByRole("button", { name: "Keep working locally", exact: true })
    .click();
  await expect(
    rail.getByRole("button", { name: "Expand sidebar" }),
  ).toBeVisible();
  await rail.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(notice).toBeVisible();
  await expect(connect.locator("span")).toBeVisible();
});

test("saves task notes before opening Connect, including an edit still awaiting autosave", async ({
  page,
}) => {
  await page.goto("/e2e/local-first.fixture.html");
  await page
    .getByRole("button", { name: "New task", exact: true })
    .filter({ visible: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "New task", exact: true });
  const title = dialog.getByRole("combobox", { name: "New task title" });
  await title.fill("Local notes before Connect today");
  await title.press("Enter");
  await expect(dialog).toHaveCount(0);
  await page
    .locator(".task-row-title")
    .filter({ hasText: "Local notes before Connect" })
    .click();
  const body =
    "# Notes\n\nKeep all supporting details, **formatting**, and links.";
  await page.getByRole("textbox", { name: "Notes", exact: true }).fill(body);
  // Leave before the debounce expires: Connect must await the editor's save.
  await page
    .getByRole("button", { name: "Connect collection", exact: true })
    .filter({ visible: true })
    .click();
  await page
    .getByRole("button", { name: "Keep working locally", exact: true })
    .click();
  await page.goto("/e2e/local-first.fixture.html");
  await page
    .locator(".task-row-title")
    .filter({ hasText: "Local notes before Connect" })
    .click();
  await page
    .getByRole("group", { name: "Editor mode", exact: true })
    .getByRole("button", { name: "Write", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Notes", exact: true }),
  ).toHaveValue(body);
});
