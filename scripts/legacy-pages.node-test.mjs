import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

test("legacy worker retires caches and redirects installed clients", async () => {
  const events = {};
  const calls = [];
  const navigations = [];
  const source = readFileSync(
    new URL("../legacy-pages/service-worker.js", import.meta.url),
    "utf8",
  );
  vm.runInNewContext(source, {
    URL,
    caches: {
      keys: async () => ["legacy-shell", "legacy-data"],
      delete: async (key) => calls.push(key),
    },
    self: {
      addEventListener: (name, handler) => (events[name] = handler),
      skipWaiting: () => calls.push("skipWaiting"),
      registration: { unregister: async () => calls.push("unregister") },
      clients: {
        claim: async () => calls.push("claim"),
        matchAll: async (options) => {
          assert.equal(options.type, "window");
          return [
            ["/tasknotes-app/", "/"],
            ["/tasknotes-app/notes/abc?q=%2F#entry", "/notes/abc?q=%2F#entry"],
          ].map(([path, target], index) => ({
            url: "https://callumalpass.github.io" + path,
            navigate: async (url) => {
              navigations.push([url, "https://app.tasknotes.dev" + target]);
              calls.push("navigate");
              if (index === 0) throw new Error("Tab closed");
            },
          }));
        },
      },
    },
  });
  events.install();
  let activation;
  events.activate({ waitUntil: (promise) => (activation = promise) });
  await activation;
  assert.deepEqual(calls, [
    "skipWaiting",
    "legacy-shell",
    "legacy-data",
    "claim",
    "unregister",
    "navigate",
    "navigate",
  ]);
  assert.equal(navigations.length, 2);
  for (const [actual, expected] of navigations) assert.equal(actual, expected);
  const html = readFileSync(
    new URL("../legacy-pages/index.html", import.meta.url),
    "utf8",
  );
  assert.ok(html.indexOf("<script>") < html.indexOf('http-equiv="refresh"'));
});
