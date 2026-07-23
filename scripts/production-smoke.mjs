const connectOrigin =
  process.env.MDBASE_CONNECT_ORIGIN ?? "https://connect.mdbase.dev";
const appOrigin =
  process.env.TASKNOTES_PRODUCTION_URL ??
  "https://callumalpass.github.io/tasknotes-app";

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
    if (!html.includes('<div id="root"></div>') || !html.includes("TaskNotes"))
      throw new Error("The deployed TaskNotes shell is incomplete.");
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
  await retry(check, 3);
  console.log(`Production check ${index + 1}/${checks.length} passed.`);
}

console.log("TaskNotes production boundaries are healthy.");

async function retry(check, attempts) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await check();
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts)
        await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
    }
  }
  throw lastError;
}

async function json(url) {
  return JSON.parse(await text(url));
}

async function text(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "tasknotes-production-smoke/1" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}.`);
  return response.text();
}
