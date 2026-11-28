/* global history, location, PopStateEvent, dispatchEvent, requestAnimationFrame */
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { chromium } from "@playwright/test";

const origin = new URL(process.argv[2] ?? "http://127.0.0.1:4173");
assert.ok(["localhost", "127.0.0.1"].includes(origin.hostname));
const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
    timezoneId: "UTC",
    reducedMotion: "reduce",
    serviceWorkers: "block",
  });
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin.origin
      ? route.continue()
      : route.abort(),
  );
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date("2026-11-04T12:00:00Z"));
  await page.goto(new URL("/search?demo=projects-scale", origin).href);
  const search = page.getByRole("searchbox", { name: "Search tasks" });
  const projects =
    "/views/" + encodeURIComponent("TaskNotes/Views/projects.base#projects");
  const go = (path) =>
    page.evaluate((next) => {
      history.pushState(null, "", next + location.search);
      dispatchEvent(new PopStateEvent("popstate"));
    }, path);
  const samples = [];
  for (let round = 0; round <= 7; round++) {
    await go("/search");
    await search.waitFor();
    const start = performance.now();
    await go(projects);
    await page
      .locator(".project-group .task-row")
      .first()
      .waitFor({ timeout: 60_000 });
    await page.evaluate(
      () =>
        new Promise((done) =>
          requestAnimationFrame(() => requestAnimationFrame(done)),
        ),
    );
    const ms = Math.round(performance.now() - start);
    const rows = await page.locator(".project-group .task-row").count();
    if (round) samples.push({ ms, rows });
  }
  const median = (key) =>
    samples.map((sample) => sample[key]).sort((a, b) => a - b)[3];
  console.log(
    JSON.stringify(
      {
        chromium: browser.version(),
        medianMs: median("ms"),
        medianRows: median("rows"),
        samples,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
