import { chromium, expect } from "@playwright/test";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { disposableCredentials } from "./credentials.mjs";
import {
  evidenceRoot,
  once,
  ownedPath,
  redact,
  saveReport,
  verifyServed,
} from "./support.mjs";

const [run, ready] = process.argv.slice(2);
if (
  !/^[a-z0-9-]+$/.test(run ?? "") ||
  !ready ||
  process.env.E2E_LAB_SCOPE !== "fresh-disposable-profile"
)
  throw Error("Explicit disposable LAB scope required");
await verifyServed(ready);
const root = ownedPath(resolve(evidenceRoot, run));
const cp = "https://connect-lab.mdbase.dev";
const report = {
  environment: "lab",
  result: "blocked",
  loginHttpStatuses: [],
  accountMatched: false,
  alerts: [],
};
const credentials = await disposableCredentials();
const context = await chromium.launchPersistentContext(
  resolve(root, "profile-a"),
  { headless: true },
);
try {
  // Diagnose one explicit second UI attempt only after proving no authenticated
  // session exists. Original attempt and its marker/evidence stay untouched.
  const before = await context.request.get(`${cp}/v1/me`);
  report.sessionBeforeHttp = before.status();
  if (before.status() !== 401)
    throw Error("Unexpected session state; no login attempt allowed");
  const page = await context.newPage();
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.origin === cp && url.pathname === "/v1/auth/password/login")
      report.loginHttpStatuses.push(response.status());
  });
  await page.goto(`${cp}/login`);
  await page.getByLabel("Email", { exact: true }).fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  credentials.email = "";
  credentials.password = "";
  const start = performance.now();
  const responded = page.waitForResponse(
    (response) => response.url() === `${cp}/v1/auth/password/login`,
    { timeout: 30000 },
  );
  await once(root, "portal-login-diagnosis", () =>
    page.getByRole("button", { name: "Sign in", exact: true }).click(),
  );
  await responded;
  await expect(page.locator("form.password-auth-form"))
    .not.toHaveAttribute("aria-busy", "true", { timeout: 10000 })
    .catch(() => {});
  report.elapsedMs = Math.round(performance.now() - start);
  report.alerts = (await page.getByRole("alert").allTextContents()).map(redact);
  const after = await context.request.get(`${cp}/v1/me`);
  report.sessionAfterHttp = after.status();
  report.accountMatched =
    after.ok() && (await after.json()).user?.id === credentials.accountId;
  report.result = report.accountMatched ? "passed" : "blocked";
  // Login page only: both credential fields are masked; never screenshot any
  // authenticated account/approval page or dump form values.
  if (
    new URL(page.url()).origin === cp &&
    new URL(page.url()).pathname === "/login"
  ) {
    report.screenshot = ownedPath(
      resolve(root, "portal-login-failure-masked.png"),
    );
    await page.screenshot({
      path: report.screenshot,
      mask: [page.locator("input, textarea, code")],
      fullPage: true,
    });
  }
} catch (error) {
  report.error =
    error.message === "Unexpected session state; no login attempt allowed"
      ? error.message
      : "Targeted login diagnostic did not complete";
} finally {
  await context.close();
  report.cleanup = "owned-browser-stopped-profile-retained";
  await saveReport(resolve(root, "login-diagnosis.json"), report);
}
console.log(
  JSON.stringify({
    result: report.result,
    http: report.loginHttpStatuses,
    evidence: resolve(root, "login-diagnosis.json"),
  }),
);
