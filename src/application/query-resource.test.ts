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
