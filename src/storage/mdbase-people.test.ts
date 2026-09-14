import type { JsonObject, MdbaseConnection } from "@mdbase-dev/connect";
import { expect, it, vi } from "vitest";
import { readPeopleDirectory } from "./mdbase-people";

const identity = {
  issuer: "https://connect.example",
  subject: "account",
  name: "Account",
};
const success = <T>(value: T) => ({ ok: true, value });
const page = (id: string, linked = false, path = `${id}.md`) =>
  success({
    results: [
      {
        path,
        frontmatter: { id, name: id, identities: linked ? [identity] : [] },
      },
    ],
  });
function fixture(queryPages: unknown, implementations = ["person"]) {
  return {
    collectionId: "collection",
    people: {
      current: async () => success(identity),
      members: async () => success([{ ...identity, role: "owner" }]),
    },
    describe: async () =>
      success({
        contracts: [
          {
            id: "mdbase.person",
            version: "1.0.0",
            implementations: implementations.map((typeName) => ({ typeName })),
          },
        ],
      }),
    queryPages,
  } as unknown as MdbaseConnection<JsonObject>;
}
it("waits for all canonical pages before resolving the current person", async () => {
  const query = vi.fn(async function* () {
    yield page("first");
    yield page("mine", true);
  });
  const controller = new AbortController();
  const directory = await readPeopleDirectory(
    fixture(query),
    controller.signal,
  );
  expect(directory.current).toEqual({ status: "linked", personId: "mine" });
  expect(directory.people).toHaveLength(2);
  expect(query).toHaveBeenCalledWith(
    {
      contract: { id: "mdbase.person", version: "1.0.0", type: "person" },
      includeBody: false,
    },
    { signal: controller.signal, pageSize: 200 },
  );
});
it("does not report an incomplete query as an unlinked account", async () => {
  const query = async function* () {
    yield page("first");
    throw new Error("Second page unavailable");
  };
  await expect(readPeopleDirectory(fixture(query))).rejects.toThrow(
    "Second page unavailable",
  );
});
it("queries every implementation and rejects conflicting projections of the same path", async () => {
  const query = vi.fn(async function* (input: { contract: { type: string } }) {
    yield page(input.contract.type, true, "same.md");
  });
  await expect(
    readPeopleDirectory(fixture(query, ["contact", "person"])),
  ).rejects.toThrow("Conflicting Person contract mappings");
  expect(query).toHaveBeenCalledTimes(2);
});
