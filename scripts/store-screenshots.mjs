#!/usr/bin/env node
/**
 * Generates the App Store and Google Play screenshots from the real app UI.
 *
 * Builds the local e2e bundle, serves it with `vite preview`, opens the curated
 * demo collection (`?demo=store`, src/demo/store-dataset.ts) under a frozen
 * clock, captures each screen and frames it under a caption from
 * store/screenshots/captions.json. See store/screenshots/README.md.
 *
 *   pnpm store:screenshots                 build, then render every locale
 *   pnpm store:screenshots --skip-build    reuse the existing dist/ build
 *   pnpm store:screenshots --locale en     render one locale
 *   pnpm store:screenshots --device play-phone    render one device
 */
/* global document -- referenced inside page.evaluate callbacks. */
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "@playwright/test";
import sharp from "sharp";

const ROOT = new URL("../", import.meta.url);
const OUTPUT = new URL("store/screenshots/", ROOT);
const PORT = 4327;
const ORIGIN = `http://127.0.0.1:${PORT}`;
/** A Tuesday morning; the demo collection's dates are relative to it. */
const CLOCK = new Date("2026-11-24T08:30:00Z");
const TIME_ZONE = "UTC";

/** App tokens from src/styles/01-foundation.css. */
const THEMES = {
  light: {
    backdrop: "oklch(97.5% 0.005 70)",
    text: "oklch(24% 0.012 55)",
    soft: "oklch(43% 0.012 60)",
    frame: "oklch(84% 0.008 70)",
    shadow: "oklch(22% 0.02 60 / 0.10)",
  },
  dark: {
    backdrop: "oklch(17.5% 0.006 70)",
    text: "oklch(93% 0.006 80)",
    soft: "oklch(79% 0.008 80)",
    frame: "oklch(40% 0.01 70)",
    shadow: "oklch(5% 0.008 60 / 0.4)",
  },
};

/**
 * Canvas sizes are CSS pixels at `scale`, giving the exact store pixel sizes.
 * The app is captured at `appScale` and placed 1:1 in physical pixels.
 */
const DEVICES = [
  {
    id: "ios-iphone-69",
    width: 440,
    height: 956,
    scale: 3,
    inset: 28,
    captionTop: 64,
    captionHeight: 96,
    captionSize: 38,
    gap: 28,
    radius: 36,
    appScale: 0.92,
  },
  {
    id: "ios-ipad-13",
    width: 1032,
    height: 1376,
    scale: 2,
    inset: 64,
    captionTop: 80,
    captionHeight: 80,
    captionSize: 56,
    gap: 48,
    radius: 28,
    appScale: 1.07,
  },
  {
    id: "play-phone",
    width: 360,
    height: 640,
    scale: 3,
    inset: 22,
    captionTop: 36,
    captionHeight: 72,
    captionSize: 28,
    gap: 20,
    radius: 26,
    appScale: 0.8,
  },
];

const view = (name) =>
  `/views/${encodeURIComponent(`TaskNotes/Views/${name}.base#${name}`)}?demo=store`;

const SHOTS = [
  { name: "01-today", caption: "today", path: "/?demo=store" },
  {
    name: "02-capture",
    caption: "capture",
    path: "/?demo=store",
    async prepare(page, captions) {
      await page
        .getByRole("button", { name: /^(Add task|New task)$/ })
        .first()
        .click();
      const input = page.getByRole("dialog").getByRole("textbox").first();
      await input.waitFor();
      await input.pressSequentially(captions.captureExample);
      await page
        .getByRole("dialog")
        .getByText(/^Scheduled /)
        .waitFor();
    },
  },
  {
    name: "03-markdown-note",
    caption: "markdown",
    path: "/task/draft-launch-announcement?demo=store",
    async prepare(page) {
      await page.getByRole("heading", { name: "Outline" }).waitFor();
      // Short phones stack too many properties above the notes: lead with them.
      if (page.viewportSize().height < 700)
        await page
          .getByText("Notes", { exact: true })
          .first()
          .evaluate((element) => {
            // Clear the sticky task toolbar.
            element.style.scrollMarginTop = "64px";
            element.scrollIntoView({ block: "start", behavior: "instant" });
          });
    },
  },
  { name: "04-calendar", caption: "calendar", path: view("calendar") },
  {
    name: "05-board",
    caption: "views",
    path: view("work-board"),
    async prepare(page) {
      // Give the board's columns the full width of a tablet.
      const toggle = page.getByRole("button", { name: "Collapse sidebar" });
      if (await toggle.isVisible()) {
        await toggle.click();
        await page.getByRole("button", { name: "Expand sidebar" }).waitFor();
      }
    },
  },
  {
    name: "06-scratchpad",
    caption: "scratchpad",
    path: "/scratchpad?demo=store",
    colorScheme: "dark",
    async prepare(page) {
      // Short phones keep the end of the current note in view; show its title.
      await page
        .locator(".scratchpad-title-row")
        .last()
        .evaluate((element) =>
          element.scrollIntoView({ block: "start", behavior: "instant" }),
        );
    },
  },
];

const args = process.argv.slice(2);
const onlyLocale = args.includes("--locale")
  ? args[args.indexOf("--locale") + 1]
  : undefined;
const onlyDevice = args.includes("--device")
  ? args[args.indexOf("--device") + 1]
  : undefined;
const allCaptions = JSON.parse(
  await readFile(new URL("captions.json", OUTPUT), "utf8"),
);
const locales = Object.keys(allCaptions).filter(
  (locale) => !onlyLocale || locale === onlyLocale,
);
if (!locales.length) throw new Error(`No captions for locale ${onlyLocale}.`);

if (!args.includes("--skip-build")) await run("pnpm", ["build:e2e"]);
const server = spawn(
  "pnpm",
  [
    "exec",
    "vite",
    "preview",
    "--mode",
    "e2e",
    "--host",
    "127.0.0.1",
    "--port",
    String(PORT),
    "--strictPort",
  ],
  { cwd: ROOT, stdio: "ignore", detached: true },
);
const browser = await chromium.launch();
try {
  await waitForServer();
  const fonts = await fontFaces();
  for (const locale of locales) {
    const captions = allCaptions[locale];
    for (const device of DEVICES.filter(
      ({ id }) => !onlyDevice || id === onlyDevice,
    )) {
      const directory = new URL(`${device.id}/${locale}/`, OUTPUT);
      await rm(directory, { recursive: true, force: true });
      await mkdir(directory, { recursive: true });
      for (const shot of SHOTS) {
        const capture = await captureApp(device, shot, locale, captions);
        const framed = await compose(
          device,
          shot.colorScheme ?? "light",
          captions[shot.caption],
          capture,
          fonts,
        );
        await writeFile(new URL(`${shot.name}.png`, directory), framed);
        console.log(`${device.id}/${locale}/${shot.name}.png`);
      }
    }
  }
  await writeFile(
    new URL("play-feature-graphic.png", OUTPUT),
    await featureGraphic(allCaptions.en.featureGraphic, fonts),
  );
  console.log("play-feature-graphic.png");
} finally {
  await browser.close();
  process.kill(-server.pid);
}

function appGeometry(device) {
  const top = device.captionTop + device.captionHeight + device.gap;
  const width = device.width - 2 * device.inset;
  const height = device.height - top - device.inset;
  return {
    top,
    width,
    height,
    viewport: {
      width: Math.round(width / device.appScale),
      height: Math.round(height / device.appScale),
    },
  };
}

async function captureApp(device, shot, locale, captions) {
  const { viewport } = appGeometry(device);
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: device.scale * device.appScale,
    isMobile: true,
    hasTouch: true,
    locale,
    timezoneId: TIME_ZONE,
    colorScheme: shot.colorScheme ?? "light",
    reducedMotion: "reduce",
    serviceWorkers: "block",
  });
  // Keep the run local and deterministic: nothing leaves the preview server.
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === ORIGIN
      ? route.continue()
      : route.abort("blockedbyclient"),
  );
  const page = await context.newPage();
  await page.clock.setFixedTime(CLOCK);
  await page.goto(`${ORIGIN}${shot.path}`);
  await page.locator("main h1, main h2").first().waitFor({ state: "attached" });
  await page.waitForLoadState("networkidle");
  await shot.prepare?.(page, captions, device);
  await page.evaluate(() => document.fonts.ready);
  await delay(600);
  const image = await page.screenshot({ animations: "disabled" });
  await context.close();
  return image;
}

async function compose(device, scheme, caption, capture, fonts) {
  if (!caption) throw new Error(`Missing caption for ${device.id}.`);
  const theme = THEMES[scheme];
  const app = appGeometry(device);
  const page = await browser.newPage({
    viewport: { width: device.width, height: device.height },
    deviceScaleFactor: device.scale,
  });
  await page.setContent(`<!doctype html>
<style>
  ${fonts}
  html, body { margin: 0; width: ${device.width}px; height: ${device.height}px;
    overflow: hidden; background: ${theme.backdrop}; }
  .caption { position: absolute; left: ${device.inset}px; right: ${device.inset}px;
    top: ${device.captionTop}px; height: ${device.captionHeight}px;
    display: flex; align-items: center; justify-content: center;
    margin: 0; text-align: center; text-wrap: balance; color: ${theme.text};
    font: 700 ${device.captionSize}px/1.15 "Atkinson Hyperlegible", sans-serif;
    letter-spacing: -0.01em; }
  .app { position: absolute; left: ${device.inset}px; top: ${app.top}px;
    width: ${app.width}px; height: ${app.height}px; overflow: hidden;
    border-radius: ${device.radius}px;
    box-shadow: 0 0 0 1px ${theme.frame}, 0 12px 40px ${theme.shadow}; }
  .app img { display: block; width: 100%; height: 100%; }
</style>
<h1 class="caption">${escapeHtml(caption)}</h1>
<div class="app"><img src="data:image/png;base64,${capture.toString("base64")}"></div>`);
  await page.evaluate(() => document.fonts.ready);
  const overflow = await page
    .locator(".caption")
    .evaluate((element) => element.scrollHeight > element.clientHeight + 1);
  if (overflow) throw new Error(`Caption too long on ${device.id}: ${caption}`);
  const image = await page.screenshot();
  await page.close();
  return optimise(image);
}

async function featureGraphic(line, fonts) {
  const theme = THEMES.light;
  const icon = await readFile(new URL("public/icon-512.png", ROOT));
  const page = await browser.newPage({
    viewport: { width: 1024, height: 500 },
  });
  await page.setContent(`<!doctype html>
<style>
  ${fonts}
  html, body { margin: 0; width: 1024px; height: 500px; overflow: hidden;
    background: ${theme.backdrop}; }
  main { height: 100%; display: flex; align-items: center; justify-content: center;
    gap: 44px; font-family: "Atkinson Hyperlegible", sans-serif; }
  img { width: 168px; height: 168px; border-radius: 38px;
    box-shadow: 0 0 0 1px ${theme.frame}; }
  h1 { margin: 0; font-size: 72px; line-height: 1; letter-spacing: -0.015em;
    color: ${theme.text}; }
  p { margin: 18px 0 0; font-size: 30px; font-weight: 400; color: ${theme.soft}; }
</style>
<main>
  <img src="data:image/png;base64,${icon.toString("base64")}" alt="">
  <div><h1>TaskNotes</h1><p>${escapeHtml(line)}</p></div>
</main>`);
  await page.evaluate(() => document.fonts.ready);
  const image = await page.screenshot();
  await page.close();
  return optimise(image);
}

/** Opaque RGB PNGs: Apple rejects screenshots with an alpha channel. */
function optimise(image) {
  return sharp(image)
    .removeAlpha()
    .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false })
    .toBuffer();
}

async function fontFaces() {
  const files = new URL(
    "node_modules/@fontsource/atkinson-hyperlegible/files/",
    ROOT,
  );
  const faces = [];
  for (const weight of [400, 700]) {
    const font = await readFile(
      new URL(`atkinson-hyperlegible-latin-${weight}-normal.woff2`, files),
    );
    faces.push(
      `@font-face { font-family: "Atkinson Hyperlegible"; font-weight: ${weight}; src: url(data:font/woff2;base64,${font.toString("base64")}) format("woff2"); }`,
    );
  }
  return faces.join("\n");
}

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(ORIGIN)).ok) return;
    } catch {
      // Not listening yet.
    }
    await delay(200);
  }
  throw new Error(`The preview server did not start on ${ORIGIN}.`);
}

function run(command, commandArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { cwd: ROOT, stdio: "inherit" });
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} ${commandArgs.join(" ")} failed`)),
    );
  });
}

function escapeHtml(text) {
  return text.replace(
    /[&<>"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character],
  );
}
