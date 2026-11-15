import assert from "node:assert/strict";
const origin = new URL(
  process.env.APP_URL || "https://tasknotes-import.pages.dev",
).origin;
for (const path of [
  "/",
  "/auth/todoist/callback",
  "/auth/mdbase/callback",
  "/oauth/todoist-client.json",
  "/.well-known/mdbase-app.json",
]) {
  const response = await fetch(origin + path, {
    signal: AbortSignal.timeout(20_000),
    redirect: "manual",
  });
  assert.equal(response.status, 200, `${path} must return 200`);
  assert.ok(
    response.headers.get("content-security-policy"),
    `${path} must have CSP`,
  );
  if (path.endsWith(".json")) {
    const value = await response.json();
    if (path.includes("todoist")) {
      assert.equal(value.client_id, `${origin}/oauth/todoist-client.json`);
      assert.deepEqual(value.redirect_uris, [
        `${origin}/auth/todoist/callback`,
      ]);
    } else {
      assert.equal(value.homepage, `${origin}/`);
      assert.deepEqual(value.redirect_uris, [`${origin}/auth/mdbase/callback`]);
      assert.equal(value.provisions.type_packs.length, 1);
    }
  } else
    assert.match(await response.text(), /<title>Import · TaskNotes<\/title>/);
  console.log(`OK ${path}`);
}
