/* global document, history, location, dispatchEvent, PopStateEvent, requestAnimationFrame */
// Pass two loopback e2e previews to alternate the order of paired builds.
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const origins = process.argv.slice(2).map((url) => new URL(url));
assert.ok(
  origins.length &&
    origins.every((url) => ["127.0.0.1", "localhost"].includes(url.hostname)),
);
const browser = await chromium.launch();
const rounds = Number(process.env.TASKNOTES_BENCH_ROUNDS ?? 7);
const results = {};
const view = (slug) =>
  "/views/" + encodeURIComponent("TaskNotes/Views/" + slug + ".base#" + slug);

async function sample(origin, size) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    timezoneId: "UTC",
    locale: "en-US",
    reducedMotion: "reduce",
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  await page.clock.setFixedTime(new Date("2026-11-04T12:00:00Z"));
  const samples = {};
  const ready = (selector) =>
    page.waitForFunction(
      (selector) =>
        document.querySelector(selector)?.getBoundingClientRect().height > 0,
      selector,
    );
  async function measure(name, act) {
    try {
      const start = performance.now();
      await act();
      await page.evaluate(
        () =>
          new Promise((done) =>
            requestAnimationFrame(() => requestAnimationFrame(done)),
          ),
      );
      samples[name] = Math.round(performance.now() - start);
    } catch (cause) {
      throw new Error(name, { cause });
    }
  }
  async function go(path, selector) {
    await page.evaluate((next) => {
      history.pushState(null, "", next + location.search);
      dispatchEvent(new PopStateEvent("popstate"));
    }, path);
    await ready(selector);
  }
  try {
    for (const mode of ["cold", "warm"]) {
      await measure(mode + " open", async () => {
        await page.goto(new URL("?demo=" + size, origin).href);
        await ready(".task-row-title");
      });
      for (const [name, path, selector] of [
        ["Upcoming", view("upcoming"), ".tnc-list-lead .task-row-title"],
        ["Calendar", view("calendar"), ".tnc-dg .tnc-item"],
        ["Tasks", view("inbox"), ".task-list-view .task-row-title"],
        ["Projects", view("projects"), ".project-group .task-row"],
        ["Kanban", view("work-board"), ".kanban-card"],
        ["Scratchpad", "/scratchpad", ".scratchpad-document-stream"],
        ["Search", "/search", ".browse-fields"],
        ["Today", view("today"), ".task-row-title"],
      ])
        await measure(mode + " " + name, () => go(path, selector));

      const prefix = mode + " ";
      const project = page.locator(
        '.navigation-project-section button[aria-label^="Operations "] small',
      );
      const count = Number(await project.textContent());
      const title = "Workflow capture " + mode;
      await page
        .getByRole("button", { name: "New task", exact: true })
        .filter({ visible: true })
        .click();
      const input = page
        .getByRole("textbox", { name: "New task title" })
        .filter({ visible: true })
        .last();
      await input.fill(title + " +Operations #workflowtag today");
      await measure(prefix + "capture + project count", async () => {
        await input.press("Enter");
        await page.waitForFunction(
          (n) =>
            document.querySelector(
              '.navigation-project-section button[aria-label^="Operations "] small',
            )?.textContent === String(n),
          count + 1,
        );
      });
      await go("/search", "#task-search");
      const search = page.getByRole("searchbox", { name: "Search tasks" });
      const row = page
        .locator(".search-results .task-row-title")
        .filter({ hasText: title });
      await measure(prefix + "title filter", async () => {
        await search.fill(title);
        await row.waitFor();
      });
      await search.fill("");
      await page.locator(".browse-fields").waitFor();
      await measure(prefix + "tag filter", async () => {
        await search.fill("workflowtag");
        await row.waitFor();
        await page.locator(".search-result-count").waitFor();
      });
      const editor = page.getByRole("textbox", {
        name: "Task title",
        exact: true,
      });
      await measure(prefix + "open detail", async () => {
        await row.click();
        await editor.waitFor();
      });
      const edited = title + " edited";
      await measure(prefix + "edit, save + reopen", async () => {
        await editor.fill(edited);
        await editor.blur();
        await page
          .getByRole("button", { name: "Close task details", exact: true })
          .click();
        await page
          .getByRole("button", { name: edited, exact: true })
          .first()
          .click();
        await page.waitForFunction(
          (value) => document.querySelector("#task-title")?.value === value,
          edited,
        );
      });
      await page
        .getByRole("button", { name: "Close task details", exact: true })
        .click();
      const complete = page
        .getByRole("button", { name: edited, exact: true })
        .first();
      await complete.focus();
      await measure(prefix + "complete + project count", async () => {
        await page.keyboard.press("x");
        await page.waitForFunction(
          (n) =>
            document.querySelector(
              '.navigation-project-section button[aria-label^="Operations "] small',
            )?.textContent === String(n),
          count,
        );
      });
      await go(view("upcoming"), ".tnc-list-lead .task-row-title");
      const lead = page.locator(".tnc-list-lead");
      const group = lead.locator(".agenda-row-group").nth(80);
      const destination =
        size === 10000
          ? group
          : page.locator(".tnc-list-section[data-date]").last();
      await measure(prefix + "agenda scroll", async () => {
        await destination.scrollIntoViewIfNeeded();
        if (size === 10000)
          await group.locator(".task-row-title").first().waitFor();
      });
      const source = lead.getByRole("button", {
        name: "Book the project room",
        exact: true,
      });
      if (size === 10000)
        await lead
          .locator(".agenda-row-group")
          .first()
          .evaluate((el) => el.scrollIntoView({ block: "start" }));
      else await lead.getByRole("heading").scrollIntoViewIfNeeded();
      await source.evaluate((el) => el.scrollIntoView({ block: "center" }));
      const day = await page
        .locator(".tnc-strip-day[aria-current=date] + button")
        .getAttribute("data-date");
      const target = page.locator(`.tnc-strip-day[data-date="${day}"]`);
      const from = await source.boundingBox(),
        to = await target.boundingBox();
      await measure(prefix + "agenda drag", async () => {
        await page.mouse.move(from.x + 20, from.y + from.height / 2);
        await page.mouse.down();
        await page.mouse.move(from.x + 20, from.y + from.height / 2 + 10, {
          steps: 3,
        });
        await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
          steps: 10,
        });
        await page.mouse.up();
        await source.waitFor({ state: "hidden" });
        await target.click();
        await page
          .locator('.tnc-list-section[data-date="' + day + '"]')
          .getByRole("button", { name: "Book the project room", exact: true })
          .waitFor();
      });
    }
    return samples;
  } finally {
    await context.close();
  }
}
try {
  for (let round = 0; round < rounds; round++)
    for (const size of [60, 10000])
      for (const origin of round % 2 ? [...origins].reverse() : origins) {
        const samples = await sample(origin, size);
        const group = ((results[origin.origin] ??= {})[size] ??= {});
        for (const [key, value] of Object.entries(samples))
          (group[key] ??= []).push(value);
        console.error(
          JSON.stringify({ round, origin: origin.origin, size, samples }),
        );
      }
  console.log(JSON.stringify({ chromium: browser.version(), results }));
} finally {
  await browser.close();
}
