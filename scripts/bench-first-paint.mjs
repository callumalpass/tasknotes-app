/* global document, window, requestAnimationFrame */
// First usable task row in the local SDK protocol fixture.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";

const origins = (
  process.argv.length > 2 ? process.argv.slice(2) : ["http://127.0.0.1:4173"]
).map((url) => new URL(url));
for (const origin of origins)
  assert.ok(["localhost", "127.0.0.1"].includes(origin.hostname));
const size = Number(process.env.TASKNOTES_BENCH_TASKS ?? 10000);
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
  await page.clock.setFixedTime(new Date("2026-11-04T12:00:00Z"));
  await page.addInitScript((size) => {
    window.__TASKNOTES_NEXT_SMOKE__ = {
      records: Array.from({ length: size }, (_, index) => ({
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
  }, size);
  for (const mode of ["cold", "warm"]) {
    await page.goto(origin.href);
    const open = page.getByRole("button", {
      name: "Open synced fixture collection",
    });
    await open.waitFor();
    // Include seeding, SDK open, React commit and a paint opportunity.
    const start = performance.now();
    await open.evaluate((button) => button.click());
    await page.waitForFunction(
      () =>
        document.querySelector(".task-row-title")?.getBoundingClientRect()
          .height > 0,
    );
    await page.evaluate(
      () =>
        new Promise((done) =>
          requestAnimationFrame(() => requestAnimationFrame(done)),
        ),
    );
    samples[mode].push(Math.round(performance.now() - start));
  }
  await context.close();
}
try {
  for (let round = 0; round < 7; round++) {
    for (const origin of round % 2 ? [...origins].reverse() : origins)
      await openCollection(origin);
    console.log(JSON.stringify({ round, results }));
  }
  console.log(JSON.stringify({ size, chromium: browser.version(), results }));
} finally {
  await browser.close();
}
