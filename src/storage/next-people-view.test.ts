import type { MdbasePeopleClient, PersonRecord } from "@mdbase-dev/sdk";
import { peopleView } from "./mdbase-people";

// Public SDK result compatibility with the existing display adapter only.
// Metadata/projection fixtures are stand-ins, not a connection/authority bridge.
type Directory = Awaited<ReturnType<MdbasePeopleClient["directory"]>>;
const identity = {
  issuer: "https://identity.example",
  subject: "opaque-subject",
};
const accountId = "10000000-0000-4000-8000-000000000001";
const person: PersonRecord = {
  id: "20000000-0000-4000-8000-000000000002",
  path: "people/current-person.md",
  name: "Alex",
  identities: [identity],
  typeNames: ["mapped-profile"],
};
function directory(overrides: Partial<Directory> = {}): Directory {
  return {
    account: { ...identity, accountId, name: "Authenticated account" },
    me: { status: "linked", person },
    people: [person],
    invalid: [],
    ...overrides,
  };
}

it("displays the SDK's linked person path and name, never its native UUID or account UUID", () => {
  const view = peopleView(directory());
  expect(view.current).toEqual({ status: "linked", personPath: person.path });
  expect(view.people).toEqual([
    { name: "Alex", path: person.path, ambiguousIdentity: false },
  ]);
  expect(view.settingsUrl).toBeUndefined();
});

it.each<Directory["me"]>([
  { status: "unlinked" },
  { status: "ambiguous", paths: ["people/a.md", "people/b.md"] },
  { status: "invalid", paths: ["people/broken.md"] },
])(
  "retains the SDK's $status resolution instead of guessing from account identity",
  (me) => {
    expect(peopleView(directory({ me })).current).toEqual(me);
  },
);

it("uses only exact approved issuer/subject membership and leaves identity-free membership unknown", () => {
  const issuerMismatch = {
    ...person,
    id: "20000000-0000-4000-8000-000000000003",
    path: "people/other-issuer.md",
    identities: [{ ...identity, issuer: "https://other.example" }],
  };
  const subjectMismatch = {
    ...person,
    id: "20000000-0000-4000-8000-000000000004",
    path: "people/account-id-is-not-subject.md",
    identities: [{ ...identity, subject: accountId }],
  };
  const identityFree = {
    ...person,
    id: "20000000-0000-4000-8000-000000000005",
    path: "people/agent.md",
    identities: [],
  };
  const view = peopleView(
    directory({
      people: [person, issuerMismatch, subjectMismatch, identityFree],
      members: [
        { ...identity, accountId, name: "Approved member", role: "owner" },
      ],
    }),
  );
  expect(view.people.map((p) => p.activeMember)).toEqual([
    true,
    false,
    false,
    undefined,
  ]);
  expect("activeMember" in view.people[3]!).toBe(false);
});

it("does not turn omitted SDK membership into a negative membership claim", () => {
  const unknown = peopleView(directory());
  const emptyApproved = peopleView(directory({ members: [] }));
  expect("activeMember" in unknown.people[0]!).toBe(false);
  expect(emptyApproved.people[0]!.activeMember).toBe(false);
});

it("marks duplicate identity claims while preserving the SDK's ambiguous resolution", () => {
  const duplicate = {
    ...person,
    id: "20000000-0000-4000-8000-000000000006",
    path: "people/duplicate.md",
  };
  const me: Directory["me"] = {
    status: "ambiguous",
    paths: [person.path, duplicate.path],
  };
  const view = peopleView(directory({ people: [person, duplicate], me }));
  expect(view.current).toEqual(me);
  expect(view.people.map((p) => p.ambiguousIdentity)).toEqual([true, true]);
});

it("preserves only the SDK-supplied person settings URL without deriving a route from the account", () => {
  const personSettingsUrl = "https://connect.example/settings#your-person";
  const view = peopleView(
    directory({
      account: { ...identity, accountId, name: "Account", personSettingsUrl },
    }),
  );
  expect(view.settingsUrl).toBe(personSettingsUrl);
  expect(peopleView(directory()).settingsUrl).toBeUndefined();
});
