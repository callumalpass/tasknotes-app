/* global history, location, PopStateEvent, dispatchEvent, requestAnimationFrame, window */
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

const origin = new URL(process.argv[2] ?? "http://127.0.0.1:4173");
assert.ok(["localhost", "127.0.0.1"].includes(origin.hostname));
const browser = await chromium.launch();
const samples = {};
const fixedTime = new Date("2026-11-04T12:00:00Z");

async function localPage() {
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
  page.setDefaultTimeout(60_000);
  await page.clock.setFixedTime(fixedTime);
  return page;
}

async function navigate(page, path) {
  await page.evaluate((path) => {
    history.pushState(null, "", path + location.search);
    dispatchEvent(new PopStateEvent("popstate"));
  }, path);
}

async function paint(page) {
  await page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(done)),
      ),
  );
}

async function measure(page, round, name, work) {
  const start = performance.now();
  await work();
  await paint(page);
  if (round) (samples[name] ??= []).push(Math.round(performance.now() - start));
}

try {
  const demo = await localPage();
  await demo.goto(new URL("/search?demo=10000", origin).href);
  const search = demo.getByRole("searchbox", { name: "Search tasks" });
  const matching = demo.getByRole("button", {
    name: "Review demo task 9999",
    exact: true,
  });
  const list = demo.locator(".task-list-view .task-row-title");
  const inbox =
    "/views/" + encodeURIComponent("TaskNotes/Views/inbox.base#inbox");

  const notes = await localPage();
  await notes.addInitScript(
    ({ day, size }) => {
      window.__TASKNOTES_NEXT_SMOKE__ = {
        records: Array.from({ length: size }, (_, index) => {
          const date = new Date(day - index * 86_400_000).toISOString();
          return {
            path: `TaskNotes/Scratchpad/note-${index}.md`,
            types: ["tasknotes-scratch"],
            frontmatter: {
              type: "tasknotes-scratch",
              id: `note-${index}`,
              state: index === 0 ? "active" : "converted",
              dateCreated: date,
              dateModified: date,
              title: `Note ${index}`,
            },
            body: (
              `Body of note ${index}\n` +
              "- More notes to review.\n".repeat(100)
            ).slice(0, 2048),
          };
        }),
      };
    },
    { day: fixedTime.valueOf(), size: 10_000 },
  );
  await notes.goto(new URL("/scratchpad", origin).href);
  await notes
    .getByRole("button", { name: "Open synced fixture collection" })
    .click();
  const disclosures = notes.locator(
    ".scratchpad-history .scratchpad-document-disclosure",
  );
  const older = notes.locator('[data-feed-key="scratchpad:note-21"]');

  for (let round = 0; round <= 7; round++) {
    await navigate(demo, "/search");
    await search.fill("Review demo task ");
    await search.pressSequentially("999");
    await demo
      .getByRole("button", { name: "Review demo task 999", exact: true })
      .waitFor();
    await measure(demo, round, "searchFinalKeystroke", async () => {
      await search.press("9");
      await matching.waitFor();
    });
    await measure(demo, round, "taskListEntry", async () => {
      await navigate(demo, inbox);
      await list.first().waitFor();
    });
    assert.ok(
      (await list.count()) < 100,
      "The task list mounted too many rows",
    );

    await navigate(notes, "/search");
    await notes.getByRole("searchbox", { name: "Search tasks" }).waitFor();
    await measure(notes, round, "notesEntry", async () => {
      await navigate(notes, "/scratchpad");
      await disclosures.first().waitFor();
    });
    assert.equal(await disclosures.count(), 20);
    const showNote = older.getByRole("button", { name: /Note 21/ });
    await measure(notes, round, "notesLoadOlder", async () => {
      await notes
        .getByRole("button", { name: "Load older", exact: true })
        .click();
      await showNote.waitFor();
    });
    assert.equal(await disclosures.count(), 40);
    await measure(notes, round, "notesPreview", async () => {
      await showNote.click();
      await older
        .getByRole("textbox", { name: "Scratchpad outline" })
        .getByText("Body of note 21", { exact: true })
        .waitFor();
    });
    await older.getByRole("button", { name: "Collapse", exact: true }).click();
    await showNote.waitFor();
  }
  console.log(
    JSON.stringify(
      {
        chromium: browser.version(),
        medianMs: Object.fromEntries(
          Object.entries(samples).map(([name, values]) => [
            name,
            [...values].sort((a, b) => a - b)[3],
          ]),
        ),
        samples,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
