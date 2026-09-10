import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./local-test";

test("blocked opening screen has no serious accessibility violations", async ({
  page,
}) => {
  const requestFailures: string[] = [];
  page.on("requestfailed", (request) =>
    requestFailures.push(request.failure()?.errorText ?? ""),
  );
  await page.goto("./");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await expect(
    page.getByRole("heading", { name: "Open TaskNotes", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    "TaskNotes couldn’t open right now",
  );

  expect(requestFailures).toContain("net::ERR_BLOCKED_BY_CLIENT");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical",
    ),
  ).toEqual([]);
});
