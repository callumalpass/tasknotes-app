import type {
  JsonObject,
  MdbaseConnection,
  PeopleDirectory,
} from "@mdbase-dev/connect";
import { expect, it, vi } from "vitest";
import { peopleView, readPeopleDirectory } from "./mdbase-people";

const me = { issuer: "https://id.example", subject: "acct_me" };
const other = { issuer: "https://id.example", subject: "acct_other" };
const record = (name: string, identities = [me], path = `${name}.md`) => ({
  name,
  path,
  identities,
  typeNames: ["person"],
});
const directory = (
  overrides: Partial<PeopleDirectory> = {},
): PeopleDirectory => ({
  account: { ...me, name: "Me" },
  me: { status: "linked", person: record("mine") },
  people: [record("mine"), record("teammate", [other])],
  invalid: [],
  members: [{ ...me, name: "Me", role: "owner" }],
  ...overrides,
});

it("asks the SDK once, including members only when they were approved", async () => {
  const people = {
    directory: vi.fn(async () => ({ ok: true, value: directory() })),
  };
  const controller = new AbortController();
  const view = await readPeopleDirectory(
    { people } as unknown as MdbaseConnection<JsonObject>,
    controller.signal,
  );
  expect(people.directory).toHaveBeenCalledWith({
    signal: controller.signal,
    members: "if-approved",
  });
  expect(view.current).toEqual({ status: "linked", personPath: "mine.md" });
  expect(view.people.map((person) => person.activeMember)).toEqual([
    true,
    false,
  ]);
});

it("keeps membership unknown when the member directory was declined", () => {
  const view = peopleView(directory({ members: undefined }));
  expect(view.people.every((person) => !("activeMember" in person))).toBe(
    true,
  );
});

it("uses the server-provided settings route, never the issuer", () => {
  expect(peopleView(directory()).settingsUrl).toBeUndefined();
  const url = "https://editor.example/?collection=c&surface=settings#your-person";
  expect(
    peopleView(
      directory({ account: { ...me, name: "Me", personSettingsUrl: url } }),
    ).settingsUrl,
  ).toBe(url);
});

it("marks shared account links without choosing between them", () => {
  const view = peopleView(
    directory({
      me: { status: "ambiguous", paths: ["a.md", "b.md"] },
      people: [record("A", [me], "a.md"), record("B", [me], "b.md")],
    }),
  );
  expect(view.current).toEqual({ status: "ambiguous", paths: ["a.md", "b.md"] });
  expect(view.people.every((person) => person.ambiguousIdentity)).toBe(true);
});

it("surfaces SDK failures instead of an empty directory", async () => {
  const people = {
    directory: async () => ({
      ok: false,
      problem: { code: "temporarily_unavailable", message: "Unavailable" },
    }),
  };
  await expect(
    readPeopleDirectory({ people } as unknown as MdbaseConnection<JsonObject>),
  ).rejects.toThrow();
});

it("does not judge membership for records without a linked account", () => {
  const view = peopleView(
    directory({ people: [record("mine"), record("teammate", [other]), record("Bob", [])] }),
  );
  expect(view.people.map((person) => [person.name, person.activeMember])).toEqual([
    ["mine", true],
    ["teammate", false],
    ["Bob", undefined],
  ]);
});
