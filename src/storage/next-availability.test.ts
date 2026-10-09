import { MdbaseError } from "@mdbase-dev/sdk";
import { afterEach, expect, it, vi } from "vitest";
import { nextTaskFixture } from "../test/next-task-fixture";
import { deferred } from "../test/mdbase-fixture";

// Original SDK client and protocol test replica, not native READ or LAB proof.
const fixtures: Awaited<ReturnType<typeof nextTaskFixture>>[] = [];
afterEach(() => {
  fixtures.splice(0).forEach((fixture) => fixture.close());
  vi.restoreAllMocks();
});
async function fixture() {
  const f = await nextTaskFixture();
  fixtures.push(f);
  return f;
}
const unavailable = () =>
  new MdbaseError({
    code: "unavailable",
    recovery: "retry",
    message: "The original collection is unavailable.",
  });

it("reports an unavailable refresh, retains previously loaded search and clears the notice only after a successful retry", async () => {
  const f = await fixture();
  const task = await f.repository.create({ title: "Previously loaded task" });
  await f.repository.refresh();
  const describe = vi.mocked(f.client.describe);
  const original = describe.getMockImplementation()!;
  const changes = vi.fn();
  f.repository.subscribe(changes);
  describe.mockRejectedValue(unavailable());
  await expect(f.repository.refresh()).rejects.toMatchObject({
    code: "unavailable",
  });
  expect(await f.repository.connectionStatus()).toMatchObject({
    state: "unavailable",
    message: "The original collection is unavailable.",
  });
  expect(changes).toHaveBeenCalledWith({ kind: "status" });
  const cached = await f.repository.search({ search: "Previously" });
  expect(cached.map((result) => result.task.id)).toEqual([task.id]);
  expect(cached[0]!.bodyMatches).toEqual([]);
  expect((await f.repository.connectionStatus()).state).toBe("unavailable");
  describe.mockImplementation(original);
  await f.repository.refresh();
  expect((await f.repository.connectionStatus()).state).toBe("connected");
});

it("keeps known unavailability visible while a retry has only metadata and is still loading task data", async () => {
  const f = await fixture();
  await f.repository.create({ title: "Previously loaded task" });
  await f.repository.refresh();
  const describe = vi.mocked(f.client.describe);
  const originalDescribe = describe.getMockImplementation()!;
  describe.mockRejectedValue(unavailable());
  await expect(f.repository.refresh()).rejects.toMatchObject({
    code: "unavailable",
  });
  describe.mockImplementation(originalDescribe);
  const started = deferred<void>();
  const release = deferred<void>();
  const originalPages = f.client.pages.bind(f.client);
  vi.spyOn(f.client, "pages").mockImplementationOnce((...args) =>
    (async function* () {
      started.resolve();
      await release.promise;
      yield* originalPages(...args);
    })(),
  );
  const retry = f.repository.refresh();
  try {
    await started.promise;
    expect((await f.repository.connectionStatus()).state).toBe("unavailable");
  } finally {
    release.resolve();
    await retry;
  }
  expect((await f.repository.connectionStatus()).state).toBe("connected");
});

it("never invents a complete cached index when the first native load fails", async () => {
  const f = await fixture();
  vi.mocked(f.client.describe).mockRejectedValue(unavailable());
  await expect(
    f.repository.search({ search: "Missing" }),
  ).rejects.toMatchObject({
    code: "unavailable",
  });
});

it.each([
  new DOMException("Lifecycle cancelled", "AbortError"),
  new MdbaseError({
    code: "cancelled",
    recovery: "none",
    message: "Cancelled",
  }),
  new MdbaseError({
    code: "forbidden",
    recovery: "reauthorize",
    message: "Forbidden",
  }),
  new MdbaseError({
    code: "conflict",
    recovery: "refresh",
    message: "Changed",
  }),
])(
  "does not turn %s into unavailability or cached search authority",
  async (reason) => {
    const f = await fixture();
    await f.repository.create({ title: "Previously loaded task" });
    await f.repository.refresh();
    vi.mocked(f.client.describe).mockRejectedValue(reason);
    await expect(f.repository.refresh()).rejects.toBe(reason);
    expect((await f.repository.connectionStatus()).state).toBe("connected");
    await expect(f.repository.search({ search: "Previously" })).rejects.toBe(
      reason,
    );
  },
);

it("does not guess assignment or body matches from previously loaded task metadata", async () => {
  const f = await fixture();
  await f.repository.create({ title: "Known title", body: "body-only-needle" });
  await f.repository.refresh();
  vi.mocked(f.client.describe).mockRejectedValue(unavailable());
  await expect(f.repository.refresh()).rejects.toMatchObject({
    code: "unavailable",
  });
  expect(await f.repository.search({ search: "body-only-needle" })).toEqual([]);
  await expect(
    f.repository.search({ search: "Known", assignedTo: "some-record" }),
  ).rejects.toMatchObject({ code: "unavailable" });
  expect((await f.repository.connectionStatus()).state).toBe("unavailable");
});
