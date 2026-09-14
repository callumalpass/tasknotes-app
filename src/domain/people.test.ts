import { expect, it } from "vitest";
import { buildPeopleDirectory, personFromProjection } from "./people";
const identity = { issuer: "https://connect.example", subject: "Account_A" };
const person = {
  id: "person_one",
  name: "Callum",
  path: "people/callum.md",
  identities: [identity],
};

it("resolves account-wide identities exactly and preserves their person ID", () => {
  const result = buildPeopleDirectory(
    [person],
    identity,
    [identity],
    "collection",
  );
  expect(result.current).toEqual({ status: "linked", personId: "person_one" });
  expect(result.people[0].activeMember).toBe(true);
  expect(result.profileUrl).toContain("collection=collection");
  expect(
    buildPeopleDirectory(
      [person],
      { ...identity, subject: "account_a" },
      [],
      "collection",
    ).current,
  ).toEqual({ status: "unlinked" });
  expect(
    buildPeopleDirectory(
      [person],
      { ...identity, issuer: identity.issuer + "/" },
      [],
      "collection",
    ).current,
  ).toEqual({ status: "unlinked" });
});
it("reports duplicate identities and duplicate person IDs as ambiguous", () => {
  expect(
    buildPeopleDirectory(
      [person, { ...person, path: "other.md", id: "other" }],
      identity,
      [],
      "collection",
    ).current,
  ).toEqual({ status: "ambiguous" });
  const duplicate = buildPeopleDirectory(
    [person, { ...person, path: "other.md", identities: [] }],
    identity,
    [],
    "collection",
  );
  expect(duplicate.current).toEqual({ status: "ambiguous" });
  expect(duplicate.people.every((entry) => entry.ambiguousId)).toBe(true);
});
it("marks shared account associations as ambiguous for assignment choices", () => {
  const result = buildPeopleDirectory(
    [person, { ...person, path: "other.md", id: "other" }],
    identity,
    [identity],
    "collection",
  );
  expect(
    result.people.every(
      (entry) => entry.activeMember && entry.ambiguousIdentity,
    ),
  ).toBe(true);
  const repeated = buildPeopleDirectory(
    [{ ...person, identities: [identity, identity] }],
    identity,
    [identity],
    "collection",
  );
  expect(repeated.people[0].ambiguousIdentity).toBe(false);
});
it("retains former collaborators as people without suggesting them as active members", () => {
  const result = buildPeopleDirectory([person], identity, [], "collection");
  expect(result.people[0]).toMatchObject({
    id: person.id,
    activeMember: false,
  });
});
it("accepts accountless contacts but rejects malformed projections instead of guessing", () => {
  expect(
    personFromProjection("person.md", { id: "local", name: "Local contact" })
      .identities,
  ).toEqual([]);
  expect(() =>
    personFromProjection("person.md", { id: "", name: "Name" }),
  ).toThrow("Invalid person");
  expect(() =>
    personFromProjection("person.md", {
      id: "one",
      name: "Name",
      identities: [{ subject: "one" }],
    }),
  ).toThrow("Invalid identity");
});
