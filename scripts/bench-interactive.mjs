/* global history, location, dispatchEvent, PopStateEvent, requestAnimationFrame, document, window */
// Run against the built e2e fixture with a loopback Vite preview.
import { chromium } from "@playwright/test";
import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";

const origin = new URL(process.argv[2] ?? "http://127.0.0.1:4173");
assert.ok(["localhost", "127.0.0.1"].includes(origin.hostname));
const browser = await chromium.launch();
try {
  for (const size of [1000, 10000]) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
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
    page.setDefaultTimeout(120_000);
    await page.clock.setFixedTime(new Date("2026-11-04T12:00:00Z"));
    await page.goto(new URL(`?demo=${size}`, origin).href);
    await page.locator(".task-row-title").first().waitFor();
    const navigate = async (slug) => {
      const route =
        slug === "search"
          ? "/search"
          : "/views/" +
            encodeURIComponent(`TaskNotes/Views/${slug}.base#${slug}`);
      await page.evaluate((route) => {
        history.pushState(null, "", route + location.search);
        dispatchEvent(new PopStateEvent("popstate"));
      }, route);
    };
    const rows = page.locator(".bounded-list .task-row");
    const samples = {};
    for (let round = 0; round <= 7; round++) {
      // Include React commit and a paint opportunity after the visible outcome.
      const sample = async (name, run) => {
        const start = performance.now();
        await run();
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );
        if (round)
          (samples[name] ??= []).push(Math.round(performance.now() - start));
      };
      await sample("calendar", async () => {
        await navigate("calendar");
        await page.locator(".tnc-item").first().waitFor();
      });
      await sample("kanban", async () => {
        await navigate("work-board");
        await page.locator(".kanban-card").first().waitFor();
        await page
          .getByText(`Loaded 200 of ${size} matching tasks.`, { exact: false })
          .first()
          .waitFor();
      });
      await sample("searchSwitch", async () => {
        await navigate("search");
        await page.getByPlaceholder("Tasks, tags, projects").waitFor();
      });
      await sample("searchFilter", async () => {
        await page
          .getByPlaceholder("Tasks, tags, projects")
          .fill("Review demo task 990");
        await page
          .getByRole("button", { name: "Review demo task 990", exact: true })
          .first()
          .waitFor();
      });
      await sample("virtualListSwitch", async () => {
        await navigate("inbox");
        await rows.first().waitFor();
      });
      const firstId = await rows.first().getAttribute("data-task-id");
      await sample("virtualListScroll", async () => {
        await page.evaluate(() => window.scrollTo(0, 3500));
        await page.waitForFunction(
          (id) =>
            document
              .querySelector(".bounded-list .task-row")
              ?.getAttribute("data-task-id") !== id,
          firstId,
        );
      });
      await page.evaluate(() => window.scrollTo(0, 0));
      await rows.first().locator(".task-row-title").focus();
      await sample("singleCompletion", async () => {
        await page.keyboard.press("x");
        await page.locator(".task-completed-notice").waitFor();
      });
      await page.keyboard.press("Control+z");
      await page.locator(".task-completed-notice").waitFor({ state: "hidden" });
      for (const index of [0, 2]) {
        await rows.nth(index).locator(".task-row-title").focus();
        await page.keyboard.press("v");
      }
      await page
        .getByRole("combobox", { name: "Priority for selected tasks" })
        .click();
      await sample("bulkPriority", async () => {
        await page.getByRole("option", { name: "High", exact: true }).click();
        await page.locator(".bulk-update-notice").waitFor();
      });
      await page
        .locator(".bulk-update-notice")
        .getByRole("button", { name: "Undo" })
        .click();
      await page.keyboard.press("Escape");
      console.error(`${size} tasks, round ${round} complete`);
    }
    console.log(
      JSON.stringify({
        size,
        chromium: browser.version(),
        samples,
        medianMs: Object.fromEntries(
          Object.entries(samples).map(([k, v]) => [
            k,
            [...v].sort((a, b) => a - b)[3],
          ]),
        ),
      }),
    );
    await context.close();
  }
} finally {
  await browser.close();
}
