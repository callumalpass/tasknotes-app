/* global history, location, dispatchEvent, PopStateEvent, requestAnimationFrame */
// Compare built e2e fixtures with the same local Chromium, clock and viewport.
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { chromium } from "@playwright/test";

const origin = new URL(process.argv[2] ?? "http://127.0.0.1:4173");
assert.ok(["localhost", "127.0.0.1"].includes(origin.hostname));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    timezoneId: "UTC",
    reducedMotion: "reduce",
    serviceWorkers: "block",
  });
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin.origin
      ? route.continue()
      : route.abort(),
  );
  page.setDefaultTimeout(120000);
  await page.clock.setFixedTime(new Date("2026-11-04T12:00:00Z"));
  await page.goto(new URL("?demo=10000", origin).href);
  await page.locator(".task-row-title").first().waitFor();
  const navigate = (path) =>
    page.evaluate((path) => {
      history.pushState(null, "", path + location.search);
      dispatchEvent(new PopStateEvent("popstate"));
    }, path);
  const samples = [];
  for (let run = 0; run < 6; run++) {
    await navigate("/search");
    await page.getByPlaceholder("Tasks, tags, projects").waitFor();
    const start = performance.now();
    await navigate(
      "/views/" + encodeURIComponent("TaskNotes/Views/upcoming.base#upcoming"),
    );
    const rows = page.locator(".tnc-item--list .task-row-title");
    await rows.first().waitFor();
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    const result = {
      ms: Math.round(performance.now() - start),
      rows: await rows.count(),
      shells: await page.locator(".tnc-item--list").count(),
    };
    console.error(run, result);
    if (run) samples.push(result);
  }
  const median = (field) =>
    samples.map((s) => s[field]).sort((a, b) => a - b)[2];
  console.log(
    JSON.stringify({
      chromium: browser.version(),
      samples,
      medianMs: median("ms"),
      medianRows: median("rows"),
      medianShells: median("shells"),
    }),
  );
} finally {
  await browser.close();
}
