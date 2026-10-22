import { chromium, expect } from "@playwright/test";
import { disposableCredentials } from "./credentials.mjs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  evidenceRoot,
  expected,
  once,
  ownedPath,
  redact,
  saveReport,
  verifyServed,
} from "./support.mjs";
import { UserJourney } from "./journeys.mjs";

const [run, ready] = process.argv.slice(2);
if (
  !/^[a-z0-9-]+$/.test(run ?? "") ||
  !ready ||
  process.env.E2E_LAB_SCOPE !== "fresh-disposable-profile"
)
  throw Error("Explicit disposable LAB scope, run and release READY required");
const cp = "https://connect-lab.mdbase.dev";
const root = ownedPath(resolve(evidenceRoot, run));
const reportPath = resolve(
  root,
  `approval-report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
);
await verifyServed(ready);
const report = {
  environment: "lab",
  source: expected.source,
  result: "blocked",
  stage: "credential-lookup",
  timings: {},
  clicks: 0,
  accountMatched: false,
  cleanup: "pending",
};
let context, app, portal, journey;
try {
  const credentials = await disposableCredentials();
  context = await chromium.launchPersistentContext(resolve(root, "profile-a"), {
    headless: true,
    viewport: { width: 1440, height: 1000 },
  });
  await context.route("**/*", async (route) => {
    if (
      route.request().isNavigationRequest() &&
      ![cp, new URL(expected.url).origin].includes(
        new URL(route.request().url()).origin,
      )
    ) {
      await route.abort();
      return;
    }
    await route.continue();
  });
  portal = await context.newPage();
  report.stage = "ordinary-portal-login";
  const loginStart = performance.now();
  const priorMe = await context.request.get(`${cp}/v1/me`);
  if (priorMe.status() === 401) {
    await portal.goto(`${cp}/login`);
    await portal.getByLabel("Email", { exact: true }).fill(credentials.email);
    await portal
      .getByLabel("Password", { exact: true })
      .fill(credentials.password);
    await once(root, "portal-login-correct-format", () =>
      portal.getByRole("button", { name: "Sign in", exact: true }).click(),
    );
    report.clicks++;
    await expect(portal.getByLabel("Password", { exact: true })).toHaveCount(
      0,
      { timeout: 30000 },
    );
  } else if (!priorMe.ok())
    throw Error("Unexpected disposable portal session status");
  else report.ownPortalSessionResumed = true;
  credentials.email = "";
  credentials.password = "";
  const me = await context.request.get(`${cp}/v1/me`);
  report.accountMatched =
    me.ok() && (await me.json()).user?.id === credentials.accountId;
  if (!report.accountMatched)
    throw Error("Disposable-account identity mismatch");
  report.timings.portalLoginMs = Math.round(performance.now() - loginStart);

  app = await context.newPage();
  journey = new UserJourney(app, root);
  await app.goto(expected.url);
  async function appClick(name, marker) {
    const start = performance.now();
    const action = () => app.getByRole("button", { name, exact: true }).click();
    if (marker) await once(root, marker, action);
    else await action();
    report.clicks++;
    await expect(app.locator("main")).toHaveAttribute("aria-busy", "false", {
      timeout: 65000,
    });
    report.timings[name] = Math.round(performance.now() - start);
    if (await app.getByRole("alert").count())
      throw Error(
        `App refused: ${redact(await app.getByRole("alert").innerText())}`,
      );
  }
  report.stage = "resume-own-pending-request";
  try {
    await appClick("Resume this device's original sign-in");
  } catch (error) {
    const expired = app.getByRole("button", {
      name: "Start a new sign-in request on this device",
      exact: true,
    });
    if (
      !error.message.includes("This sign-in request expired.") ||
      !(await expired.isVisible())
    )
      throw error;
    report.expiredOriginalRequestObserved = true;
    await appClick(
      "Start a new sign-in request on this device",
      "renew-expired-original-request",
    );
  }
  const href = await app
    .getByRole("link", {
      name: "Select account and approve in mdbase Connect",
      exact: true,
    })
    .getAttribute("href");
  if (new URL(href).origin !== cp) throw Error("Portal origin mismatch");
  await portal.goto(href);
  report.stage = "select-disposable-account";
  await once(root, "select-account", () =>
    portal
      .getByRole("button", { name: "Use this account", exact: true })
      .click(),
  );
  report.clicks++;
  await appClick("Check original approval");
  await appClick("Confirm this account on this device", "confirm-account");
  await appClick("Send original device approval", "attest-device");
  report.stage = "ordinary-device-approval";
  await portal
    .getByRole("button", { name: "Check device key", exact: true })
    .click();
  report.clicks++;
  await expect(
    portal.getByRole("button", { name: "Approve this device", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await portal
    .getByRole("checkbox", { name: "Create new collections", exact: true })
    .check();
  report.clicks++;
  await once(root, "approve-device", () =>
    portal
      .getByRole("button", { name: "Approve this device", exact: true })
      .click(),
  );
  report.clicks++;
  await appClick("Check original approval");
  report.stage = "paired";
  await appClick("Refresh approved collections");
  report.approvedCollectionCount = await app.locator("section ul li").count();
  report.uiText = redact(await app.locator("main").innerText());
  report.screenshot = await journey.screenshot("paired");
  report.result = "passed";
} catch (error) {
  // Avoid Playwright's credential-bearing locator/call log after field fill.
  report.error =
    report.stage === "ordinary-portal-login"
      ? "Ordinary portal login did not complete"
      : redact(error.message);
  if (app && journey)
    report.screenshot = await journey
      .screenshot("approval-failure")
      .catch(() => null);
} finally {
  await context?.close();
  report.cleanup = "owned-browser-stopped-profile-retained";
  await saveReport(reportPath, report);
}
console.log(
  JSON.stringify({
    result: report.result,
    stage: report.stage,
    evidence: reportPath,
  }),
);
if (report.result !== "passed") process.exitCode = 1;
