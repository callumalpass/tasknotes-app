export interface PersonIdentity {
  issuer: string;
  subject: string;
}

export interface Person {
  id: string;
  name: string;
  path: string;
  identities: PersonIdentity[];
}

export type CurrentPerson =
  | { status: "unlinked" }
  | { status: "ambiguous" }
  | { status: "linked"; personId: string };

export interface PeopleDirectory {
  people: Array<
    Person & {
      activeMember: boolean;
      ambiguousId: boolean;
      ambiguousIdentity: boolean;
    }
  >;
  current: CurrentPerson;
  profileUrl: string;
}

export function samePersonIdentity(
  left: PersonIdentity,
  right: PersonIdentity,
): boolean {
  return left.issuer === right.issuer && left.subject === right.subject;
}

export function buildPeopleDirectory(
  people: Person[],
  identity: PersonIdentity,
  members: PersonIdentity[],
  collectionId: string,
): PeopleDirectory {
  const matches = people.filter((person) =>
    person.identities.some((candidate) =>
      samePersonIdentity(candidate, identity),
    ),
  );
  const counts = new Map<string, number>();
  const identityCounts = new Map<string, number>();
  const identityKey = (value: PersonIdentity) =>
    JSON.stringify([value.issuer, value.subject]);
  for (const person of people) {
    counts.set(person.id, (counts.get(person.id) ?? 0) + 1);
    for (const key of new Set(person.identities.map(identityKey)))
      identityCounts.set(key, (identityCounts.get(key) ?? 0) + 1);
  }
  const current: CurrentPerson =
    matches.length === 0
      ? { status: "unlinked" }
      : matches.length !== 1 || counts.get(matches[0].id) !== 1
        ? { status: "ambiguous" }
        : { status: "linked", personId: matches[0].id };
  const url = new URL("/", identity.issuer);
  url.searchParams.set("collection", collectionId);
  url.searchParams.set("surface", "settings");
  return {
    current,
    profileUrl: url.href,
    people: people.map((person) => ({
      ...person,
      activeMember: person.identities.some((candidate) =>
        members.some((member) => samePersonIdentity(candidate, member)),
      ),
      ambiguousId: counts.get(person.id) !== 1,
      ambiguousIdentity: person.identities.some(
        (candidate) => identityCounts.get(identityKey(candidate)) !== 1,
      ),
    })),
  };
}

export function personFromProjection(
  path: string,
  value: Record<string, unknown>,
): Person {
  const { id, name, identities = [] } = value;
  if (
    typeof id !== "string" ||
    !id.trim() ||
    typeof name !== "string" ||
    !name.trim() ||
    !Array.isArray(identities)
  ) {
    throw new Error(`Invalid person record: ${path}`);
  }
  const accounts: PersonIdentity[] = identities.map((identity: unknown) => {
    if (
      !identity ||
      typeof identity !== "object" ||
      !("issuer" in identity) ||
      !("subject" in identity) ||
      typeof identity.issuer !== "string" ||
      typeof identity.subject !== "string" ||
      !identity.subject.trim()
    )
      throw new Error(`Invalid identity in ${path}`);
    return { issuer: identity.issuer, subject: identity.subject };
  });
  return { path, id, name, identities: accounts };
}
