import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  inventoryDirectory,
  assertInventory,
  verifyServedBytes,
} from "./lib/native-publish-bytes.mjs";

const project = fileURLToPath(new URL("../", import.meta.url));
const origin = "https://staging.example.test";
const digest = (body) => createHash("sha256").update(body).digest("hex");
const entry = (name, body) => ({
  path: name,
  bytes: Buffer.byteLength(body),
  sha256: digest(body),
});
async function fixture(t, files = {}) {
  const root = await fs.mkdtemp(
    path.join(project, ".native-publish-byte-tests-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const [name, body] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), body);
  }
  return root;
}
class MockResponse {
  constructor(
    body = new Uint8Array(),
    { status = 200, headers = {}, url = "", redirected = false } = {},
  ) {
    this.status = status;
    this.headers = new Headers(headers);
    this.url = url;
    this.redirected = redirected;
    this.body = new ReadableStream({
      start(controller) {
        controller.enqueue(Buffer.from(body));
        controller.close();
      },
    });
  }
}
const verify = (inventory, fetch, options = {}) =>
  verifyServedBytes(origin, inventory, {
    fetch,
    sleep: async () => {},
    ...options,
  });

test("inventory includes every final byte, dotfiles, workers, native and trust assets, sorted", async (t) => {
  const files = {
    "index.html": "html",
    ".well-known/mdbase.json": "trust",
    ".hidden": "dot",
    "_worker.js": "worker",
    "native/a.wasm": Buffer.from([0, 255]),
    _headers: "policy",
    "z.js": "js",
  };
  const root = await fixture(t, files);
  const expected = Object.entries(files)
    .map(([name, body]) => entry(name, body))
    .sort((a, b) => (a.path < b.path ? -1 : 1));
  assert.deepEqual(await inventoryDirectory(root), expected);
  assert.deepEqual(await assertInventory(root, expected), expected);
});
for (const mutation of ["missing", "extra", "tampered", "length"]) {
  test(`assertInventory refuses ${mutation} files`, async (t) => {
    const root = await fixture(t, { "index.html": "good" });
    const expected = await inventoryDirectory(root);
    if (mutation === "missing") await fs.unlink(path.join(root, "index.html"));
    if (mutation === "extra")
      await fs.writeFile(path.join(root, ".extra"), "extra");
    if (mutation === "tampered")
      await fs.writeFile(path.join(root, "index.html"), "evil");
    if (mutation === "length")
      await fs.writeFile(path.join(root, "index.html"), "longer");
    await assert.rejects(assertInventory(root, expected), /inventory-mismatch/);
  });
}
test("rejects root and nested symlinks without following them", async (t) => {
  const root = await fixture(t, { "real/index.html": "ok" });
  await fs.symlink("real", path.join(root, "link"));
  await assert.rejects(
    inventoryDirectory(path.join(root, "link") + "/"),
    /symlink/,
  );
  await assert.rejects(inventoryDirectory(root), /symlink/);
  await fs.unlink(path.join(root, "link"));
  await fs.symlink("index.html", path.join(root, "real/link.html"));
  await assert.rejects(inventoryDirectory(root), /symlink/);
});
for (const operation of ["inventory", "assert"]) {
  test(`rejects a parent-traversal root before it can hide a symlink (${operation})`, async (t) => {
    const root = await fixture(t, {
      "base/artifact/index.html": "safe",
      "outside/artifact/index.html": "evil",
      "outside/sub/marker": "x",
    });
    await fs.symlink("../outside/sub", path.join(root, "base/link"));
    const expected = await inventoryDirectory(path.join(root, "base/artifact"));
    // Do NOT path.join this value: it would erase the traversal being tested.
    const traversal = `${root}/base/link/../artifact`;
    await assert.rejects(
      operation === "inventory"
        ? inventoryDirectory(traversal)
        : assertInventory(traversal, expected),
      /invalid-root|symlink/,
    );
  });
}
test("rejects nonregular filesystem entries", async (t) => {
  const root = await fixture(t);
  // Linux fixture only; never open the FIFO (which could otherwise block).
  const { execFileSync } = await import("node:child_process");
  execFileSync("mkfifo", [path.join(root, "fifo")]);
  await assert.rejects(inventoryDirectory(root), /nonregular/);
});
for (const unsafe of [
  "../escape",
  "/absolute",
  "a/../b",
  "a//b",
  "a\\b",
  "a%2fb",
  "a?b",
  "a#b",
  "a\nb",
  "a.",
  "CON",
  "a/./b",
  "é.html",
]) {
  test(`rejects unsafe inventory path ${JSON.stringify(unsafe)}`, async (t) => {
    const root = await fixture(t);
    const inventory = [entry(unsafe, "x")];
    await assert.rejects(assertInventory(root, inventory), /invalid-path/);
    await assert.rejects(
      verify(inventory, () => {
        throw Error("must not fetch");
      }),
      /invalid-path/,
    );
  });
}
test("rejects duplicate, case-ambiguous and file/directory-conflicting inventory paths", async (t) => {
  const root = await fixture(t);
  for (const names of [
    ["a", "a"],
    ["A", "a"],
    ["a", "a/b"],
    ["A/x", "a/y"],
  ]) {
    await assert.rejects(
      assertInventory(
        root,
        names.map((name) => entry(name, "x")),
      ),
      /duplicate-path|ambiguous-path/,
    );
  }
});
test("rejects unsafe actual paths and case-ambiguous directory names", async (t) => {
  const root = await fixture(t, { "a%2fb": "bad" });
  await assert.rejects(inventoryDirectory(root), /invalid-path/);
  await fs.unlink(path.join(root, "a%2fb"));
  await fs.mkdir(path.join(root, "A"));
  try {
    await fs.mkdir(path.join(root, "a"));
  } catch (error) {
    // A case-insensitive filesystem (default macOS APFS) cannot hold both
    // names, so this ambiguous tree cannot be constructed there. The
    // inventory-level ambiguity check is covered synthetically above.
    if (error && error.code === "EEXIST") return;
    throw error;
  }
  await assert.rejects(inventoryDirectory(root), /ambiguous-path/);
});
test("enforces bounded file, total, entry count, file count and depth limits", async (t) => {
  const root = await fixture(t, { a: "123", b: "456", "dir/c": "7" });
  for (const limits of [
    { maxFileBytes: 2 },
    { maxTotalBytes: 5 },
    { maxFiles: 1 },
    { maxEntries: 1 },
    { maxDepth: 1 },
  ]) {
    await assert.rejects(inventoryDirectory(root, limits), /limit/);
  }
});
test("validates digest, size, options and inventory records before transport", async () => {
  for (const item of [
    { ...entry("a", "x"), bytes: -1 },
    { ...entry("a", "x"), sha256: "not-sha" },
    { ...entry("a", "x"), bytes: 1.5 },
  ]) {
    await assert.rejects(
      verify([item], () => {
        throw Error("must not fetch");
      }),
      /invalid-inventory/,
    );
  }
  for (const options of [
    { attempts: 0 },
    { concurrency: 0 },
    { timeoutMs: 0 },
    { attempts: 1000 },
    { maxResponseBytes: Infinity },
  ]) {
    await assert.rejects(
      verify([], () => {}, options),
      /invalid-limit/,
    );
  }
});
for (const name of [
  "index.html",
  "manifest.webmanifest",
  "app.js",
  "service-worker.js",
  "_worker.js",
  "native/a.wasm",
  "native/sqlite.wasm",
  "data.sqlite",
  ".well-known/trust.json",
]) {
  test(`served verification rejects stale ${name} even with HTTP 200 and equal length`, async () => {
    const result = await verify(
      [entry(name, "good")],
      async () => new MockResponse("evil"),
      { attempts: 1 },
    );
    assert.deepEqual(result.verified, []);
    assert.equal(result.failures[0].path, name);
    assert.equal(result.failures[0].reason, "hash-mismatch");
  });
}
test("verifies binary bytes, root index at /, and includes dotfiles/service worker", async () => {
  const files = {
    "index.html": "html",
    ".well-known/trust": Buffer.from([255, 0, 128]),
    "service-worker.js": "sw",
  };
  const requested = [];
  const result = await verify(
    Object.entries(files).map(([name, body]) => entry(name, body)),
    async (url, init) => {
      requested.push(url);
      assert.equal(init.credentials, "omit");
      assert.equal(init.redirect, "manual");
      assert.equal(init.cache, "no-store");
      assert.equal(init.method, "GET");
      assert.equal(init.headers.Authorization, undefined);
      const name =
        new URL(url).pathname === "/"
          ? "index.html"
          : new URL(url).pathname.slice(1);
      return new MockResponse(files[name]);
    },
  );
  assert.equal(result.verified.length, 3);
  assert.deepEqual(result.failures, []);
  assert.ok(requested.includes(origin + "/"));
  assert.ok(requested.includes(origin + "/.well-known/trust"));
});
test("hosting control bytes are inventoried but never fetched or reported verified", async (t) => {
  const files = {
    _headers: "h",
    _redirects: "r",
    "_routes.json": "{}",
    "index.html": "html",
  };
  const root = await fixture(t, files);
  const inventory = await inventoryDirectory(root);
  const result = await verify(inventory, async (url) => {
    assert.equal(url, origin + "/");
    return new MockResponse("html");
  });
  assert.equal(result.verified.length, 1);
  assert.deepEqual(
    result.unverified.map((item) => item.path),
    ["_headers", "_redirects", "_routes.json"],
  );
  assert.ok(
    result.unverified.every(
      (item) => item.reason === "hosting-control-requires-trusted-policy-check",
    ),
  );
  assert.equal("success" in result, false);
});
test("only same-origin known canonical HTML redirects are followed", async () => {
  for (const [name, from, to] of [
    ["about.html", "/about.html", "/about"],
    ["docs/index.html", "/docs/index.html", "/docs/"],
  ]) {
    const urls = [];
    const result = await verify([entry(name, "html")], async (url) => {
      urls.push(url);
      return new URL(url).pathname === from
        ? new MockResponse("", { status: 308, headers: { location: to } })
        : new MockResponse("html");
    });
    assert.deepEqual(result.failures, []);
    assert.deepEqual(urls, [origin + from, origin + to]);
  }
});
for (const location of [
  "https://evil.test/about",
  "//evil.test/about",
  "/login",
  "/other",
  "/about?token=secret",
  "/about#fragment",
  "https://user:secret@staging.example.test/about",
  "/a/../about",
  "/%61bout",
  "https://staging.example.test:443/about",
]) {
  test(`refuses unapproved redirect ${location}`, async () => {
    let calls = 0;
    const result = await verify([entry("about.html", "html")], async () => {
      calls++;
      return new MockResponse("", { status: 302, headers: { location } });
    });
    assert.equal(calls, 1);
    assert.equal(result.failures[0].reason, "unsafe-redirect");
    assert.equal(JSON.stringify(result).includes("secret"), false);
  });
}
test("redirect loops, asset redirects, and auto-followed responses are refused", async () => {
  for (const [name, response] of [
    [
      "about.html",
      () =>
        new MockResponse("", { status: 302, headers: { location: "/about" } }),
    ],
    [
      "app.js",
      () =>
        new MockResponse("", { status: 302, headers: { location: "/app" } }),
    ],
    [
      "index.html",
      () =>
        new MockResponse("html", {
          redirected: true,
          url: "https://evil.test/",
        }),
    ],
    ["index.html", () => new MockResponse("html", { url: origin + "/login" })],
  ]) {
    const result = await verify([entry(name, "html")], async () => response());
    assert.equal(result.verified.length, 0);
    assert.match(result.failures[0].reason, /redirect|response-url/);
  }
});
test("parent-trusted explicit same-origin URL mapping supports canonical route layouts", async () => {
  const result = await verify(
    [entry("docs/index.html", "html")],
    async (url) => {
      assert.equal(url, origin + "/docs");
      return new MockResponse("html");
    },
    { urlMapping: { "docs/index.html": "/docs" } },
  );
  assert.equal(result.verified.length, 1);
  for (const urlMapping of [
    { "docs/index.html": "https://evil.test/docs" },
    { unknown: "/docs" },
    { "docs/index.html": "/docs?secret=x" },
    { "docs/index.html": "/a/../docs" },
    { "docs/index.html": "/%64ocs" },
  ]) {
    await assert.rejects(
      verify(
        [entry("docs/index.html", "html")],
        () => {
          throw Error("no fetch");
        },
        { urlMapping },
      ),
      /invalid-url-mapping/,
    );
  }
  await assert.rejects(
    verify([entry("a", "x"), entry("b", "x")], () => {}, {
      urlMapping: { a: "/same", b: "/same" },
    }),
    /ambiguous-url/,
  );
});
test("exact HTTPS origin only, no credentials, paths, query, fragment, or normalized authority", async () => {
  for (const bad of [
    "http://staging.example.test",
    origin + "/",
    origin + "/path",
    origin + "?a",
    origin + "#a",
    "https://u:p@staging.example.test",
    "https://STAGING.example.test",
    "https://staging.example.test:443",
  ]) {
    await assert.rejects(
      verifyServedBytes(bad, [], {
        fetch: () => {
          throw Error("no fetch");
        },
      }),
      /invalid-origin/,
    );
  }
});
test("oversize headers, streamed bodies, wrong length and bodyless responses fail", async () => {
  for (const response of [
    () => new MockResponse("x", { headers: { "content-length": "1000" } }),
    () => new MockResponse("too long"),
    () => new MockResponse(""),
    () => ({ status: 200, headers: new Headers(), body: null }),
  ]) {
    const result = await verify(
      [entry("app.js", "x")],
      async () => response(),
      { attempts: 1, maxResponseBytes: 2 },
    );
    assert.match(
      result.failures[0].reason,
      /response-too-large|length-mismatch|missing-body/,
    );
  }
});
test("times out hung fetches and response streams even when transport ignores abort", async () => {
  for (const fetch of [
    () => new Promise(() => {}),
    async () => ({
      status: 200,
      headers: new Headers(),
      body: new ReadableStream({
        pull() {
          return new Promise(() => {});
        },
      }),
    }),
  ]) {
    const result = await verify([entry("app.js", "x")], fetch, {
      timeoutMs: 10,
      attempts: 2,
    });
    assert.equal(result.failures[0].reason, "timeout");
    assert.equal(result.failures[0].attempts, 2);
  }
});
test("publication-wide deadline stops retries and leaves later assets explicitly failed", async () => {
  const signals = [];
  const result = await verify(
    ["a", "b", "c"].map((name) => entry(name, "x")),
    (_url, init) => {
      signals.push(init.signal);
      return new Promise(() => {});
    },
    { totalTimeoutMs: 10, timeoutMs: 30, attempts: 3, concurrency: 1 },
  );
  assert.equal(signals.length, 1);
  assert.ok(signals.every((signal) => signal.aborted));
  assert.deepEqual(result.failures, [
    { path: "a", reason: "publication-timeout", attempts: 1 },
    { path: "b", reason: "publication-timeout", attempts: 0 },
    { path: "c", reason: "publication-timeout", attempts: 0 },
  ]);
  assert.deepEqual(result.verified, []);
});
test("publication-wide deadline also bounds an abort-ignoring retry delay", async () => {
  let calls = 0;
  const result = await verify(
    [entry("a", "x"), entry("b", "x")],
    async () => {
      calls++;
      return new MockResponse("y");
    },
    {
      totalTimeoutMs: 10,
      timeoutMs: 30,
      concurrency: 1,
      sleep: () => new Promise(() => {}),
    },
  );
  assert.equal(calls, 1);
  assert.deepEqual(
    result.failures.map((item) => item.reason),
    ["publication-timeout", "publication-timeout"],
  );
  assert.equal(result.failures[1].attempts, 0);
});
test("publication-wide deadline is a lowerable hard ceiling", async () => {
  for (const totalTimeoutMs of [0, 180_001, Infinity]) {
    await assert.rejects(
      verify([], () => {}, { totalTimeoutMs }),
      /invalid-limit/,
    );
  }
});
test("bounded retries permit eventual byte propagation but cannot hide exhaustion", async () => {
  let calls = 0;
  const delays = [];
  const result = await verify(
    [entry("app.js", "good")],
    async () => new MockResponse(++calls < 3 ? "evil" : "good"),
    { attempts: 3, retryDelayMs: 7, sleep: async (ms) => delays.push(ms) },
  );
  assert.equal(result.verified[0].attempts, 3);
  assert.deepEqual(delays, [7, 7]);
  calls = 0;
  const failed = await verify(
    [entry("app.js", "good")],
    async () => {
      calls++;
      throw Error("secret transport body");
    },
    { attempts: 2 },
  );
  assert.equal(calls, 2);
  assert.equal(failed.failures[0].reason, "transport-error");
  assert.equal(JSON.stringify(failed).includes("secret"), false);
});
test("retry delay itself is bounded even for a hanging injected sleep", async () => {
  const result = await verify(
    [entry("a", "x")],
    async () => new MockResponse("y"),
    { attempts: 2, timeoutMs: 10, sleep: () => new Promise(() => {}) },
  );
  assert.equal(result.failures[0].reason, "retry-delay-timeout");
});
test("bounded concurrency and deterministic path ordering", async () => {
  let active = 0;
  let peak = 0;
  const inventory = ["d", "c", "b", "a"].map((name) => entry(name, "x"));
  const result = await verify(
    inventory,
    async () => {
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active--;
      return new MockResponse("x");
    },
    { concurrency: 2 },
  );
  assert.equal(peak, 2);
  assert.deepEqual(
    result.verified.map((item) => item.path),
    ["a", "b", "c", "d"],
  );
});
test("aggregate response budget spans retries and files", async () => {
  const result = await verify(
    [entry("a", "xx"), entry("b", "xx")],
    async () => new MockResponse("yy"),
    { maxTotalResponseBytes: 3, concurrency: 1, attempts: 2 },
  );
  assert.ok(
    result.failures.some((item) => item.reason === "total-response-limit"),
  );
  assert.equal(result.verified.length, 0);
});
test("HTTP errors are byte failures, never body/secret evidence or auth bypass", async () => {
  const calls = [];
  const result = await verify([entry("a", "x")], async (url, init) => {
    calls.push(init);
    return new MockResponse("private login secret", { status: 401 });
  });
  assert.equal(calls.length, 1);
  assert.equal(result.failures[0].reason, "http-status-401");
  assert.equal(JSON.stringify(result).includes("secret"), false);
});
test("empty files have real SHA256 evidence, not a truthiness shortcut", async (t) => {
  const root = await fixture(t, { empty: "" });
  const inventory = await inventoryDirectory(root);
  assert.deepEqual(inventory, [entry("empty", "")]);
  const result = await verify(inventory, async () => new MockResponse(""));
  assert.equal(result.verified[0].bytes, 0);
  assert.deepEqual(result.failures, []);
});
test("rejects root paths through a symlinked ancestor", async (t) => {
  const root = await fixture(t, { "real/nested/a": "x" });
  await fs.symlink("real", path.join(root, "link"));
  await assert.rejects(
    inventoryDirectory(path.join(root, "link/nested")),
    /symlink/,
  );
});
test("expected inventory limits are checked before any fetch", async () => {
  const inventory = [entry("a", "xxx"), entry("b", "yyy")];
  for (const options of [
    { maxFiles: 1 },
    { maxFileBytes: 2 },
    { maxTotalBytes: 5 },
    { maxEntries: 1 },
  ]) {
    await assert.rejects(
      verify(
        inventory,
        () => {
          throw Error("must not fetch");
        },
        options,
      ),
      /limit/,
    );
  }
  await assert.rejects(
    verify(new Array(1), () => {}),
    /invalid-inventory/,
  );
});
test("canonical route collisions cannot let two files reuse one served URL", async () => {
  for (const names of [
    ["index.html", "x.html", "x"],
    ["docs/page.html", "docs/page"],
  ]) {
    await assert.rejects(
      verify(
        names.map((name) => entry(name, "x")),
        () => {},
      ),
      /ambiguous-url/,
    );
  }
});
test("absolute trusted same-origin mappings work but mapped routes cannot redirect", async () => {
  const options = { urlMapping: { "about.html": origin + "/approved" } };
  const good = await verify(
    [entry("about.html", "x")],
    async (url) => {
      assert.equal(url, origin + "/approved");
      return new MockResponse("x", { url });
    },
    options,
  );
  assert.equal(good.verified.length, 1);
  const failed = await verify(
    [entry("about.html", "x")],
    async () =>
      new MockResponse("", { status: 301, headers: { location: "/about" } }),
    options,
  );
  assert.equal(failed.failures[0].reason, "unsafe-redirect");
});
test("no marker, content length or HTTP success substitute for actual byte evidence", async () => {
  for (const response of [
    () =>
      new MockResponse("stale SOURCE_SHA approved", {
        headers: { "content-length": "4" },
      }),
    () => new MockResponse("good", { status: 206 }),
    () => new MockResponse("good", { status: 304 }),
    () => new MockResponse("good", { headers: { "content-length": "NaN" } }),
  ]) {
    const result = await verify([entry("a", "good")], async () => response(), {
      attempts: 1,
    });
    assert.equal(result.verified.length, 0);
    assert.equal(result.failures.length, 1);
  }
});
test("served missing files are retried only to the bounded attempt limit", async () => {
  let calls = 0;
  const result = await verify(
    [entry("a", "x")],
    async () => {
      calls++;
      return new MockResponse("Not found", { status: 404 });
    },
    { attempts: 2 },
  );
  assert.equal(calls, 2);
  assert.deepEqual(result.failures, [
    { path: "a", reason: "http-status-404", attempts: 2 },
  ]);
});
test("stream timeout cannot be starved by an endless sequence of empty chunks", async () => {
  const result = await verify(
    [entry("a", "x")],
    async () => ({
      status: 200,
      headers: new Headers(),
      body: new ReadableStream({
        pull(controller) {
          controller.enqueue(new Uint8Array());
        },
      }),
    }),
    { timeoutMs: 5, attempts: 1 },
  );
  assert.equal(result.failures[0].reason, "timeout");
});
test("late timed-out responses are cancelled and cannot create evidence", async () => {
  let cancelled = false;
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const result = await verify([entry("a", "x")], () => pending, {
    timeoutMs: 5,
    attempts: 1,
  });
  release({
    status: 200,
    body: new ReadableStream({
      cancel() {
        cancelled = true;
      },
    }),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelled, true);
  assert.equal(result.verified.length, 0);
  assert.equal(result.failures[0].reason, "timeout");
});
test("untrusted transport errors cannot spoof internal reasons and leak bodies", async () => {
  const result = await verify(
    [entry("a", "x")],
    async () => {
      throw { byteReason: "private secret body", retryable: false };
    },
    { attempts: 1 },
  );
  assert.deepEqual(result.failures, [
    { path: "a", reason: "transport-error", attempts: 1 },
  ]);
});
test("nonbyte stream chunks are rejected without string coercion", async () => {
  const result = await verify(
    [entry("a", "x")],
    async () => ({
      status: 200,
      headers: new Headers(),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue("x");
          controller.close();
        },
      }),
    }),
    { attempts: 1 },
  );
  assert.equal(result.failures[0].reason, "invalid-body-chunk");
});
