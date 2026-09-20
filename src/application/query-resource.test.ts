import { expect, it } from "vitest";
import { QueryResource } from "./query-resource";
const settle = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};
it("distinguishes failure from an empty result and retries", async () => {
  const resource = new QueryResource<string[]>();
  let fail = true;
  resource.load("search", async () => {
    if (fail) throw new Error("Offline");
    return [];
  });
  await settle();
  expect(resource.snapshot()).toMatchObject({
    status: "error",
    data: null,
    stale: false,
  });
  fail = false;
  resource.retry();
  await settle();
  expect(resource.snapshot()).toMatchObject({
    status: "success",
    data: [],
    error: null,
  });
});
it("labels retained results stale and never substitutes another query's results", async () => {
  const resource = new QueryResource<string[]>();
  resource.load("one", async () => ["old"]);
  await settle();
  resource.load("one", async () => {
    throw new Error("Refresh failed");
  });
  await settle();
  expect(resource.snapshot()).toMatchObject({
    status: "error",
    data: ["old"],
    stale: true,
  });
  resource.load("two", async () => {
    throw new Error("New search failed");
  });
  await settle();
  expect(resource.snapshot()).toMatchObject({
    status: "error",
    data: null,
    stale: false,
  });
});
it("aborts superseded and unmounted work and gives retries a fresh signal", async () => {
  const resource = new QueryResource<string[]>();
  const signals: AbortSignal[] = [];
  const request = async (signal: AbortSignal) => {
    signals.push(signal);
    return [];
  };
  resource.load("one", request);
  await settle();
  resource.load("two", request);
  await settle();
  expect(signals[0].aborted).toBe(true);
  expect(signals[1].aborted).toBe(false);
  resource.cancel();
  expect(signals[1].aborted).toBe(true);
  resource.retry();
  await settle();
  expect(signals[2].aborted).toBe(false);
});

it("ignores delayed callbacks from a superseded query", async () => {
  const resource = new QueryResource<string[]>();
  let resolve!: (value: string[]) => void;
  resource.load(
    "old",
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await settle();
  resource.load("new", async () => ["new result"]);
  await settle();
  resolve(["obsolete"]);
  await settle();
  expect(resource.snapshot().data).toEqual(["new result"]);
});
