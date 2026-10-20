import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Request } from "./local-test";

function trackRequestFailures(page: Page) {
  const failures: string[] = [];
  const inFlight = new Set<Request>();
  const navigationAborts = new Set<Request>();
  let navigationStarting = false;
  page.on("request", (request) => {
    // The outgoing document can start dependencies until the next document
    // commits, even after its main HTTP request has begun.
    if (navigationStarting && !request.isNavigationRequest())
      navigationAborts.add(request);
    inFlight.add(request);
  });
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigationStarting = false;
  });
  page.on("requestfinished", (request) => {
    inFlight.delete(request);
    navigationAborts.delete(request);
  });
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText ?? "";
    // Only requests already in flight at our explicit navigation boundary
    // may be cancelled by that navigation. New-document aborts still fail.
    if (!(navigationAborts.has(request) && failure === "net::ERR_ABORTED"))
      failures.push(failure);
    inFlight.delete(request);
    navigationAborts.delete(request);
  });
  return {
    failures,
    beforeNavigation() {
      navigationStarting = true;
      for (const request of inFlight) navigationAborts.add(request);
    },
  };
}

test("unconfigured next-only build has no serious accessibility violations", async ({
  page,
}) => {
  const requests = trackRequestFailures(page);
  await page.goto("./");
  await page.evaluate(() => localStorage.clear());
  requests.beforeNavigation();
  await page.reload();

  await expect(
    page.getByRole("heading", {
      name: "TaskNotes needs to restart.",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Restart TaskNotes" }),
  ).toBeVisible();
  await page.getByText("Technical details", { exact: true }).click();
  await expect(page.locator(".technical-details")).toContainText(
    "VITE_TASKNOTES_ENVIRONMENT must explicitly select LAB or production.",
  );

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical",
    ),
  ).toEqual([]);
  // Unconfigured next-only builds cannot contact authority. Keep all genuine
  // failures, including anything arising during the accessibility scan.
  expect(requests.failures).toEqual([]);
});

test("navigation exception retains new-document aborts and network failures", async ({
  page,
}) => {
  const requests = trackRequestFailures(page);
  await page.goto("./");
  requests.beforeNavigation();
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "TaskNotes needs to restart.",
      exact: true,
    }),
  ).toBeVisible();
  const before = requests.failures.length;
  await page.route("**/__e2e_abort_probe__", (route) => route.abort("aborted"));
  await page.route("**/__e2e_failure_probe__", (route) =>
    route.abort("failed"),
  );
  await page.evaluate(async () => {
    for (const target of ["/__e2e_abort_probe__", "/__e2e_failure_probe__"])
      await fetch(target).catch(() => {});
  });
  await expect
    .poll(() => requests.failures.slice(before))
    .toEqual(["net::ERR_ABORTED", "net::ERR_FAILED"]);
});
