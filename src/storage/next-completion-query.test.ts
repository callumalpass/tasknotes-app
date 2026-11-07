// @vitest-environment node
import { checkQuery, init } from "mdbase";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { nextTaskFixture } from "../test/next-task-fixture";
import { pinnedCoreBytes } from "./next-resource-core.test-helper.mjs";

beforeAll(async () => init({ wasm: pinnedCoreBytes() }));
afterEach(() => vi.restoreAllMocks());

it("loads project records through the SDK with a Core-valid structured sort", async () => {
  const fixture = await nextTaskFixture();
  try {
    fixture.replica.seed({
      path: "Projects/Alpha.md",
      frontmatter: { title: "Alpha" },
      types: ["project"],
    });
    const query = fixture.client.query.bind(fixture.client);
    const validated = vi
      .spyOn(fixture.client, "query")
      .mockImplementation(async (...args) => {
        await checkQuery(args[0]);
        return query(...args);
      });
    const result = await fixture.repository.completeField({
      field: "projects",
      kind: "records",
      targetTypes: ["project"],
    });
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "Projects/Alpha.md" }),
      ]),
    );
    expect(validated).toHaveBeenCalledWith(
      expect.objectContaining({
        order_by: [{ field: "file.path", direction: "asc" }],
      }),
      expect.anything(),
      expect.anything(),
    );
    await expect(checkQuery({ order_by: ["file.path"] })).rejects.toMatchObject(
      { code: "invalid_query", location: "order_by[0]" },
    );
  } finally {
    fixture.close();
  }
});
