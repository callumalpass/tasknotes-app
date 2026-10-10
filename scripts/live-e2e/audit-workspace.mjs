import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
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
import { UserJourney } from "./journeys.mjs";
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
const credentials = await disposableCredentials();
const report = {
  environment: "lab",
  source: expected.source,
  result: "blocked",
  mutationClicks: 0,
  surfaces: [],
  cleanup: [],
};
let context,
  timer,
  expired = false;
async function inspect(page, name) {
  const geometry = await page.evaluate(() => ({
    viewport: globalThis.innerWidth,
    documentWidth: globalThis.document.documentElement.scrollWidth,
    touch: globalThis.matchMedia("(pointer: coarse)").matches,
    smallVisibleButtons: [
      ...globalThis.document.querySelectorAll("button"),
    ].flatMap((button) => {
      const rect = button.getBoundingClientRect();
      if (
        rect.width <= 0 ||
        rect.height <= 0 ||
        rect.right <= 0 ||
        rect.left >= globalThis.innerWidth ||
        rect.bottom <= 0 ||
        rect.top >= globalThis.innerHeight
      )
        return [];
      if (rect.width >= 44 && rect.height >= 44) return [];
      return [
        {
          name: button.getAttribute("aria-label") ?? button.textContent ?? "",
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      ];
    }),
  }));
  geometry.smallVisibleButtons = geometry.smallVisibleButtons.map((button) => ({
    ...button,
    name: redact(button.name),
  }));
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  report.surfaces.push({
    name,
    geometry,
    alerts: (await page.getByRole("alert").allTextContents()).map(redact),
    violations: axe.violations.map(({ id, impact, description, nodes }) => ({
      id,
      impact,
      description,
      instances: nodes.length,
    })),
    screenshot: await new UserJourney(page, root).screenshot(name),
  });
}
async function scenario() {
  let fixture;
  for (const [name, width, touch, textScale] of [
    ["workspace-desktop", 1440, false, 100],
    ["workspace-phone-touch", 390, true, 100],
    ["workspace-narrow-touch-scaled", 320, true, 200],
  ]) {
    if (expired) throw Error("Read-only UI audit already expired");
    context = await chromium.launchPersistentContext(profile, {
      headless: true,
      viewport: { width, height: 900 },
      hasTouch: touch,
      isMobile: touch,
    });
    await ordinaryLogin(context, credentials, root, "audit-workspace-login");
    await observeOwnCollectionBinding(context);
    const page = await context.newPage();
    const collection = await openOwnPairedCollection(page, expected.url);
    if (fixture && fixture !== collection)
      throw Error("Audit fixture binding mismatch");
    fixture = collection;
    const title = `[test] e2e-${run} slow transport task edited`;
    await expect(
      page.getByRole("button", { name: title, exact: true }),
    ).toBeVisible({ timeout: 30000 });
    if (textScale !== 100)
      await page.evaluate((scale) => {
        globalThis.document.documentElement.style.fontSize = `${scale}%`;
      }, textScale);
    await inspect(page, name);
    await new UserJourney(page, root).openTask(title);
    await inspect(page, `${name}-details`);
    report.cleanup.push(await closeOwnedBrowser(context, profile));
    context = null;
  }
  report.result = "completed";
}
try {
  await Promise.race([
    scenario(),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        expired = true;
        reject(Error("Read-only UI audit deadline"));
      }, 150000);
    }),
  ]);
} catch (error) {
  report.error = redact(error.message);
} finally {
  clearTimeout(timer);
  if (context) report.cleanup.push(await closeOwnedBrowser(context, profile));
  await saveReport(resolve(root, "workspace-audit.json"), report);
}
console.log(
  JSON.stringify({
    result: report.result,
    surfaces: report.surfaces.map(({ name, geometry, violations }) => ({
      name,
      viewport: geometry.viewport,
      documentWidth: geometry.documentWidth,
      touch: geometry.touch,
      smallButtons: geometry.smallVisibleButtons.length,
      violations: violations.map(({ id, instances }) => ({ id, instances })),
    })),
    evidence: resolve(root, "workspace-audit.json"),
  }),
);
