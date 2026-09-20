import { expect, it } from "vitest";
import { connectSuccess } from "@mdbase-dev/connect-testing";
import { MdbaseTaskRepository } from "./mdbase-repository";
import { mdbaseFixture, taskRecord } from "../test/mdbase-fixture";

async function fixtureForSearch() {
  const records = [
    {
      ...taskRecord("a", "Alpha project", "r1"),
      path: "tasks/a.md",
      body: 'Needle and "quoted" text',
    },
    {
      ...taskRecord("b", "Bravo", "r2"),
      path: "tasks/b.md",
      body: "Needle alone",
    },
    {
      ...taskRecord("c", "Charlie", "r3"),
      path: "tasks/c.md",
      body: "Something else",
    },
  ];
  const fixture = mdbaseFixture(records);
  const repository = new MdbaseTaskRepository(fixture.connect);
  await repository.initialize();
  fixture.queryPages.mockClear();
  return { ...fixture, repository };
}

it("combines tokens across metadata and body without transferring documents", async () => {
  const fixture = await fixtureForSearch();
  const results = await fixture.repository.search({ search: "ALPHA needle" });
  expect(results.map((result) => result.task.id)).toEqual(["a"]);
  expect(results[0].bodyMatches).toEqual(["needle"]);
  expect(results[0].task).not.toHaveProperty("body");
  expect(fixture.read).not.toHaveBeenCalled();
  expect(fixture.queryPages).toHaveBeenCalledOnce();
  expect(fixture.queryPages.mock.calls[0][0]).toMatchObject({
    includeBody: false,
    projections: {
      tasknotes_body_0: { expression: 'file.body.lower().contains("alpha")' },
    },
  });
  expect(
    (await fixture.repository.search({ search: '"quoted"' }))[0].task.id,
  ).toBe("a");
});

it("requires globally body-only tokens together instead of transferring common-token matches", async () => {
  const fixture = await fixtureForSearch();
  fixture.query.mockClear();
  expect(
    (await fixture.repository.search({ search: "needle quoted" })).map(
      (result) => result.task.id,
    ),
  ).toEqual(["a"]);
  expect(fixture.queryPages.mock.calls[0][0]?.where).toBe(
    'file.body.lower().contains("needle") && file.body.lower().contains("quoted")',
  );
  expect(
    (await fixture.query.mock.results[0].value).result.results,
  ).toHaveLength(1);
  expect(fixture.read).not.toHaveBeenCalled();
});

it("needs no body query when the ordered result prefix is fully explained by metadata", async () => {
  const fixture = await fixtureForSearch();
  expect(
    (await fixture.repository.search({ search: "alpha", limit: 1 }))[0].task.id,
  ).toBe("a");
  expect(
    await fixture.repository.search({ search: "needle", limit: 0 }),
  ).toEqual([]);
  expect(fixture.queryPages).not.toHaveBeenCalled();
});

it("does not skip an unknown earlier candidate when a later page happens to arrive first", async () => {
  const fixture = await fixtureForSearch();
  let released = false;
  let pages = 0;
  fixture.queryPages.mockImplementationOnce(() =>
    (async function* () {
      try {
        for (const path of ["tasks/b.md", "tasks/a.md", "tasks/c.md"]) {
          pages++;
          yield connectSuccess({
            results: [
              {
                path,
                types: ["task"],
                file: { path },
                values: { tasknotes_body_0: true },
              },
            ],
            meta: { hasMore: true },
            page: pages - 1,
            offset: pages - 1,
            loaded: pages,
            complete: false,
          });
        }
      } finally {
        released = true;
      }
    })(),
  );
  const results = await fixture.repository.search({
    search: "needle",
    limit: 1,
  });
  expect(results[0].task.id).toBe("a");
  expect(pages).toBe(2);
  expect(released).toBe(true);
});

it("surfaces missing evidence and expression failures rather than claiming empty results", async () => {
  const fixture = await fixtureForSearch();
  fixture.queryPages.mockImplementationOnce(() =>
    (async function* () {
      yield connectSuccess({
        results: [{ path: "tasks/a.md", types: ["task"], file: {} }],
        meta: { hasMore: false },
        page: 0,
        offset: 0,
        loaded: 1,
        complete: true,
      });
    })(),
  );
  await expect(fixture.repository.search({ search: "needle" })).rejects.toThrow(
    "incomplete search match evidence",
  );
  fixture.queryPages.mockImplementationOnce(() =>
    (async function* () {
      yield connectSuccess(
        {
          results: [],
          meta: { hasMore: false },
          page: 0,
          offset: 0,
          loaded: 0,
          complete: true,
        },
        [
          {
            code: "expression_evaluation_error",
            severity: "warning",
            message: "Unsupported expression",
          },
        ],
      );
    })(),
  );
  await expect(fixture.repository.search({ search: "needle" })).rejects.toThrow(
    "evaluate this search completely",
  );
});

it("aborts superseded searches without marking the collection unavailable", async () => {
  const fixture = await fixtureForSearch();
  const controller = new AbortController();
  controller.abort();
  await expect(
    fixture.repository.search(
      { search: "needle" },
      { signal: controller.signal },
    ),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(fixture.queryPages).not.toHaveBeenCalled();
  expect(await fixture.repository.connectionStatus()).toMatchObject({
    state: "connected",
  });
});
