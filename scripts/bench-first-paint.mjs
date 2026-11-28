/* global window, requestAnimationFrame */
// First usable task row in the local SDK protocol fixture.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";

const origins = (
  process.argv.length > 2 ? process.argv.slice(2) : ["http://127.0.0.1:4173"]
).map((url) => new URL(url));
for (const origin of origins)
  assert.ok(["localhost", "127.0.0.1"].includes(origin.hostname));
const browser = await chromium.launch();
const results = Object.fromEntries(
  origins.map(({ origin }) => [origin, { cold: [], warm: [] }]),
);

async function openCollection(origin) {
  const samples = results[origin.origin];
  const context = await browser.newContext({
    timezoneId: "UTC",
    serviceWorkers: "block",
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  await page.addInitScript(() => {
    window.__TASKNOTES_NEXT_SMOKE__ = {
      records: Array.from({ length: 10_000 }, (_, index) => ({
        path: `Tasks/T${index}.md`,
        frontmatter: {
          type: "task",
          id: `task-${index}`,
          title: `Task ${index}`,
          tags: ["task"],
          status: "open",
          projects: [`P${index % 80}`],
          scheduled: "2026-11-04",
        },
        body: "Task detail. ".repeat(80),
      })),
    };
  });
  for (const mode of ["cold", "warm"]) {
    await page.goto(origin.href);
    const open = page.getByRole("button", {
      name: "Open synced fixture collection",
    });
    await open.waitFor();
    // Include seeding, SDK open, React commit and a paint opportunity.
    await open.evaluate((button) => {
      performance.mark("fixture-open");
      button.click();
    });
    await page.locator(".task-row-title").first().waitFor();
    samples[mode].push(
      await page.evaluate(async () => {
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
        return Math.round(
          performance.measure("first task", "fixture-open").duration,
        );
      }),
    );
  }
  await context.close();
}
try {
  for (let round = 0; round < 5; round++) {
    for (const origin of round % 2 ? [...origins].reverse() : origins)
      await openCollection(origin);
    console.log(JSON.stringify({ round, results }));
  }
  console.log(JSON.stringify({ chromium: browser.version(), results }));
} finally {
  await browser.close();
}
