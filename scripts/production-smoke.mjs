const connectOrigin =
  process.env.MDBASE_CONNECT_ORIGIN ?? "https://connect.mdbase.dev";
const appOrigin =
  process.env.TASKNOTES_PRODUCTION_URL ?? "https://app.tasknotes.dev";
const requireNotificationManifest =
  process.env.TASKNOTES_REQUIRE_NOTIFICATION_MANIFEST !== "0";
const retryDelays = [3_000, 6_000, 12_000, 20_000, 20_000];

const checks = [
  async () => {
    const health = await json(`${connectOrigin}/health`);
    if (health.ok !== true || health.service !== "mdbase-connect")
      throw new Error("mdbase connect returned an unexpected health response.");
  },
  async () => {
    const readiness = await json(`${connectOrigin}/ready`);
    if (readiness.ok !== true)
      throw new Error("mdbase connect is healthy but not ready.");
  },
  async () => {
    const html = await text(`${appOrigin}/`);
    if (
      !html.includes('<div id="root"></div>') ||
      !html.includes("TaskNotes") ||
      !html.includes("manifest.webmanifest")
    )
      throw new Error("The deployed TaskNotes shell is incomplete.");
  },
  async () => {
    const manifest = await json(`${appOrigin}/manifest.webmanifest`);
    if (
      manifest.name !== "TaskNotes" ||
      manifest.display !== "standalone" ||
      manifest.start_url !== "./" ||
      !manifest.icons?.some((icon) => icon.sizes === "512x512")
    )
      throw new Error("The deployed PWA manifest is invalid.");
    const worker = await text(`${appOrigin}/service-worker.js`);
    if (
      !worker.includes("tasknotes:mdbase-notification") ||
      !worker.includes("notificationclick")
    )
      throw new Error("The deployed notification service worker is invalid.");
  },
  async () => {
    const manifest = await json(`${appOrigin}/.well-known/mdbase-app.json`);
    const callback = `${appOrigin}/auth/mdbase/callback`;
    if (
      manifest.manifest_version !== 1 ||
      manifest.requirements?.access !== "full_collection" ||
      !manifest.redirect_uris?.includes(callback)
    )
      throw new Error("The deployed mdbase application manifest is invalid.");
    if (
      requireNotificationManifest &&
      (manifest.notifications?.criteria?.length !== 1 ||
        manifest.notifications.criteria[0]?.id !== "task.reminder" ||
        manifest.notifications.criteria[0]?.event?.id !==
          "mdbase.runtime.timer.fired" ||
        manifest.notifications.criteria[0]?.event?.version !== "1.0.0")
    )
      throw new Error(
        "The deployed mdbase application manifest is not reminder-only.",
      );
  },
  async () => {
    const manifest = await json(`${appOrigin}/.well-known/mdbase-app.json`);
    const validation = await postJson(`${connectOrigin}/v1/apps/validate`, {
      manifest,
    });
    if (
      validation.valid !== true ||
      validation.declaration?.family_identity !== "bundle:dev.tasknotes.app" ||
      !/^[a-f0-9]{64}$/.test(validation.declaration?.manifest_digest ?? "")
    )
      throw new Error(
        "The deployed TaskNotes declaration is not accepted by mdbase connect.",
      );
  },
  async () => {
    const callback = await text(`${appOrigin}/auth/mdbase/callback`);
    if (!callback.includes('<div id="root"></div>'))
      throw new Error(
        "The deployed authorization callback cannot load the app.",
      );
  },
];

for (const [index, check] of checks.entries()) {
  await retry(check);
  console.log(`Production check ${index + 1}/${checks.length} passed.`);
}

console.log("TaskNotes production boundaries are healthy.");

async function retry(check) {
  let lastError;
  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    try {
      await check();
      return;
    } catch (error) {
      lastError = error;
      if (attempt < retryDelays.length) {
        console.warn(
          `${error instanceof Error ? error.message : String(error)} Retrying in ${retryDelays[attempt] / 1_000}s.`,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, retryDelays[attempt]),
        );
      }
    }
  }
  throw lastError;
}

async function json(url) {
  return JSON.parse(await text(url));
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "tasknotes-production-smoke/1",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json();
  if (!response.ok) {
    const detail = payload?.error?.message ?? `HTTP ${response.status}`;
    throw new Error(`${url} rejected the declaration: ${detail}`);
  }
  return payload;
}

async function text(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "tasknotes-production-smoke/1" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}.`);
  return response.text();
}
