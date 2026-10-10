import { chromium, expect } from "@playwright/test";
import { resolve } from "node:path";
import { disposableCredentials } from "./credentials.mjs";
import {
  evidenceRoot,
  expected,
  ownedPath,
  redact,
  saveReport,
  verifyServed,
} from "./support.mjs";
import {
  closeOwnedBrowser,
  ordinaryLogin,
  observeOwnCollectionBinding,
  openOwnPairedCollection,
} from "./browser-flow.mjs";

const [run, ready] = process.argv.slice(2);
if (
  !/^[a-z0-9-]+$/.test(run ?? "") ||
  !ready ||
  process.env.E2E_LAB_SCOPE !== "fresh-disposable-profile"
)
  throw Error("Explicit disposable LAB scope required");
await verifyServed(ready);
const root = ownedPath(resolve(evidenceRoot, run)),
  profile = ownedPath(resolve(root, "profile-a"));
const reportPath = resolve(
  root,
  `sharing-inspection-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
);
const credentials = await disposableCredentials();
const report = {
  environment: "lab",
  result: "blocked",
  stage: "own-fixture-open",
  collectionMatched: false,
  invitationStarted: false,
  blockedNonLabApiOrigins: [],
  apiResponses: [],
};
let context, consolePage, timer;
async function inspect() {
  context = await chromium.launchPersistentContext(profile, { headless: true });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      ["fetch", "xhr"].includes(route.request().resourceType()) &&
      url.hostname.endsWith("mdbase.dev") &&
      !url.hostname.includes("-lab.")
    ) {
      report.blockedNonLabApiOrigins.push(url.origin);
      await route.abort();
      return;
    }
    await route.continue();
  });
  await ordinaryLogin(context, credentials, root, "primary-login-for-sharing");
  await observeOwnCollectionBinding(context);
  const app = await context.newPage();
  const ownId = await openOwnPairedCollection(app, expected.url);
  report.existingOwnFixtureOpened = true;
  const ui = await context.request.get(
    "https://connect-lab.mdbase.dev/v1/ui-configuration",
  );
  const configuration = await ui.json();
  if (
    !ui.ok() ||
    new URL(configuration.editor_url).origin !== "https://editor-lab.mdbase.dev"
  )
    throw Error("LAB control UI origin mismatch");
  report.stage = "control-collection-selection";
  consolePage = await context.newPage();
  consolePage.on("response", (response) => {
    const url = new URL(response.url());
    if (
      url.origin === "https://connect-lab.mdbase.dev" &&
      report.apiResponses.length < 30
    )
      report.apiResponses.push({
        category: url.pathname === "/v1/me" ? "/v1/me" : "other-api",
        status: response.status(),
      });
  });
  await consolePage.goto(
    `https://editor-lab.mdbase.dev/connect?collection=${ownId}`,
  );
  await expect
    .poll(
      async () =>
        (await consolePage
          .getByRole("heading", { name: "People", exact: true })
          .isVisible()) ||
        (await consolePage
          .getByRole("heading", { name: "Collections", exact: true })
          .isVisible()),
      { timeout: 30000 },
    )
    .toBe(true);
  report.collectionMatched =
    new URL(consolePage.url()).searchParams.get("collection") === ownId;
  report.invitePersonAvailable = await consolePage
    .getByRole("button", { name: "Invite person", exact: true })
    .isVisible();
  report.peopleAvailable = await consolePage
    .getByRole("heading", { name: "People", exact: true })
    .isVisible();
  report.noCollectionsEmptyState = await consolePage
    .getByText("No collections", { exact: true })
    .isVisible();
  report.result =
    report.collectionMatched && report.invitePersonAvailable
      ? "passed"
      : "blocked";
  report.stage = "control-inspected-no-invitation";
  const url = new URL(consolePage.url());
  if (
    url.origin === "https://editor-lab.mdbase.dev" &&
    url.pathname === "/connect/collections"
  ) {
    report.screenshot = ownedPath(
      resolve(root, "sharing-management-unavailable-masked.png"),
    );
    await consolePage.screenshot({
      path: report.screenshot,
      fullPage: true,
      timeout: 15000,
      mask: [
        consolePage.locator(
          "aside, code, input, textarea, select, .connect-row, .connect-rail-account",
        ),
      ],
    });
  }
}
try {
  await Promise.race([
    inspect(),
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(Error("Read-only sharing inspection deadline")),
        120000,
      );
    }),
  ]);
} catch (error) {
  report.error = redact(error.message);
} finally {
  clearTimeout(timer);
  if (consolePage && !consolePage.isClosed()) {
    const url = new URL(consolePage.url());
    report.consoleOrigin = url.origin;
    report.consolePath = url.pathname;
    report.alerts = (
      await consolePage
        .getByRole("alert")
        .allTextContents()
        .catch(() => [])
    ).map(redact);
  }
  if (context) report.cleanup = await closeOwnedBrowser(context, profile);
  await saveReport(reportPath, report);
}
console.log(
  JSON.stringify({
    result: report.result,
    stage: report.stage,
    evidence: reportPath,
  }),
);
