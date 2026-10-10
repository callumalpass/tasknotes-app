import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { resolve } from "node:path";
import {
  evidenceRoot,
  expected,
  ownedPath,
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
await verifyServed(ready);
const root = ownedPath(resolve(evidenceRoot, run));
const context = await chromium.launchPersistentContext(
  resolve(root, "audit-profile"),
  { headless: true },
);
const report = { environment: "lab", source: expected.source, surfaces: [] };
try {
  for (const [name, width, textScale] of [
    ["desktop", 1440, 100],
    ["phone", 390, 100],
    ["narrow-scaled", 320, 200],
  ]) {
    const page = await context.newPage();
    await page.setViewportSize({ width, height: 900 });
    await page.goto(expected.url);
    await page
      .getByRole("heading", { name: "Open TaskNotes", exact: true })
      .waitFor();
    if (textScale !== 100)
      await page.evaluate((scale) => {
        globalThis.document.documentElement.style.fontSize = `${scale}%`;
      }, textScale);
    const geometry = await page.evaluate(() => ({
      viewport: globalThis.innerWidth,
      documentWidth: globalThis.document.documentElement.scrollWidth,
      buttons: [...globalThis.document.querySelectorAll("button")].map(
        (element) => {
          const rect = element.getBoundingClientRect();
          return {
            name: element.textContent,
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          };
        },
      ),
    }));
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    const screenshot = await new UserJourney(page, root).screenshot(
      `entry-${name}`,
    );
    report.surfaces.push({
      name,
      width,
      textScale,
      geometry,
      screenshot,
      violations: axe.violations.map(({ id, impact, description, nodes }) => ({
        id,
        impact,
        description,
        instances: nodes.length,
      })),
    });
    await page.close();
  }
} finally {
  await context.close(); // Launched and owned here, never a shared CDP browser.
  report.cleanup = "owned-browser-stopped";
  await saveReport(resolve(root, "entry-audit.json"), report);
}
console.log(
  JSON.stringify({
    evidence: resolve(root, "entry-audit.json"),
    surfaces: report.surfaces.length,
  }),
);
