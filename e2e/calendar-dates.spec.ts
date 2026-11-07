import { expect, test, type Page } from "./local-test";

const upcoming = "views/TaskNotes%2FViews%2Fupcoming.base%23upcoming?demo=60";

test.use({ timezoneId: "UTC" });

test.beforeEach(async ({ page, isMobile }) => {
  await page.setViewportSize(
    isMobile ? { width: 412, height: 915 } : { width: 1280, height: 800 },
  );
});

async function capture(page: Page, text: string) {
  if ((page.viewportSize()?.width ?? 0) < 840)
    await page.locator(".view-context-capture").click();
  const input = page.getByRole("combobox", { name: "New task title" });
  await input.fill(text);
  await expect(
    page.getByRole("button", { name: "Remove scheduled" }),
  ).toBeVisible();
  await input.press("Enter");
  const dialog = page.getByRole("dialog", { name: "New task", exact: true });
  if ((page.viewportSize()?.width ?? 0) < 840)
    await expect(dialog).toBeHidden();
  else await expect(input).toHaveValue("");
}

test("detail dates share tabs, typing, shortcuts and focus return", async ({
  page,
}) => {
  await page.goto("?demo=60");
  await page.locator(".task-row-title").first().click();
  const detail = page.getByRole("complementary", {
    name: "Task details",
    exact: true,
  });
  for (const field of ["Scheduled", "Due"]) {
    const trigger = detail.getByRole("button", {
      name: `${field} date`,
      exact: true,
    });
    await trigger.click();
    const dialog = page.getByRole("dialog", {
      name: `${field} date calendar`,
      exact: true,
    });
    await expect(dialog.getByLabel("Type a date")).not.toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Today", exact: true }),
    ).toBeFocused();
    await dialog.getByText("Date options", { exact: true }).click();
    await expect(
      dialog.getByRole("radio", { name: new RegExp(field) }),
    ).toBeChecked();
    await dialog.getByLabel("Type a date").focus();
    await expect(dialog.getByLabel("Type a date")).toBeFocused();
    await expect(
      dialog.getByRole("button", { name: "Today", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
  }
  await detail.getByRole("button", { name: "Due date", exact: true }).click();
  await page.getByText("Date options", { exact: true }).click();
  const input = page.getByLabel("Type a date", { exact: true });
  await input.fill("tomorrow 9am");
  await expect(page.getByText(/^Enter to set/)).toBeVisible();
  await input.press("Enter");
  await expect(page.locator(".task-detail-date-popover")).toHaveCount(0);
  await expect(
    detail.getByRole("button", { name: "Due date", exact: true }),
  ).toContainText("9:00");
  await page.setViewportSize({ width: 320, height: 568 });
  await detail.getByRole("button", { name: "Due date", exact: true }).click();
  const compact = page.getByRole("dialog", { name: "Due date calendar" });
  await expect(compact).toBeInViewport({ ratio: 1 });
  await compact.getByRole("gridcell").last().scrollIntoViewIfNeeded();
  await expect(compact.getByRole("gridcell").last()).toBeInViewport();
  await compact.getByRole("button", { name: "Close dates" }).click();
});

test.describe("local calendar days", () => {
  test.use({ timezoneId: "Australia/Melbourne" });

  test("tomorrow 9am stays in Upcoming and all-day/timed counts agree", async ({
    page,
  }) => {
    await page.clock.install({ time: new Date("2026-11-04T00:00:00Z") });
    await page.goto(upcoming);
    await expect(page.locator(".tnc-strip")).toBeVisible({ timeout: 15_000 });
    const day = "2026-11-05";
    const stripDay = page.locator(`.tnc-strip-day[data-date="${day}"]`);
    await expect(stripDay.locator(".agenda-strip-count")).toHaveText(/\d+/);
    const before = Number(
      await stripDay.locator(".agenda-strip-count").textContent(),
    );
    await capture(page, "Melbourne morning review tomorrow 9am +Operations");
    await capture(page, "Melbourne all-day review tomorrow +Operations");
    await stripDay.click();
    const section = page.locator(`.tnc-list-section[data-date="${day}"]`);
    const morning = section.locator(".task-row", {
      hasText: "Melbourne morning review",
    });
    const allDay = section.locator(".task-row", {
      hasText: "Melbourne all-day review",
    });
    await expect(morning).toBeVisible();
    await expect(allDay).toBeVisible();
    await expect(morning).toContainText("Operations");
    await expect(morning.locator(".task-row-context")).toContainText("9");
    await expect(morning).not.toContainText("Tomorrow");
    await expect(allDay).not.toContainText("Tomorrow");
    await expect(stripDay.locator(".agenda-strip-count")).toHaveText(
      String(before + 2),
    );
    await expect(section.locator(".agenda-day-count")).toHaveText(
      String(before + 2),
    );
    await expect(section.locator(".tnc-item--list")).toHaveCount(before + 2);
    await expect(
      section.locator(".tnc-item--list", {
        hasText: "Melbourne morning review",
      }),
    ).toHaveAttribute("data-date", day);
    await page.getByLabel("Calendar layout").click();
    await page.getByRole("button", { name: "Week", exact: true }).click();
    await expect(
      page.getByRole("complementary", { name: "Selected day" }),
    ).toHaveCount(0);
    await page.locator(`.tnc-tg-head .tnc-dh[data-date="${day}"]`).click();
    const inspector = page.getByRole("complementary", { name: "Selected day" });
    await expect(inspector).toBeFocused();
    await expect(inspector).toContainText(`${before + 2} tasks`);
    await expect(
      inspector.getByRole("button", {
        name: "Melbourne morning review",
        exact: true,
      }),
    ).toBeVisible();
    await inspector.getByRole("button", { name: "Close day details" }).click();
    await expect(inspector).toHaveCount(0);
  });
});
