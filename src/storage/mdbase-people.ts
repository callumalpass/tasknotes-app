import type {
  JsonObject,
  MdbaseConnection,
  PeopleDirectory as ConnectPeopleDirectory,
} from "@mdbase-dev/connect";
import { sameIdentity } from "@mdbase-dev/connect";
import { requireConnectOutcome } from "../cloud/outcome";
import type { CurrentPerson, PeopleDirectory } from "../domain/people";

/** Resolution happens once, in the SDK; this only adapts it for display. */
export async function readPeopleDirectory(
  connection: MdbaseConnection<JsonObject>,
  signal?: AbortSignal,
): Promise<PeopleDirectory> {
  return peopleView(
    requireConnectOutcome(
      await connection.people.directory({ signal, members: "if-approved" }),
    ),
  );
}

export function peopleView(directory: ConnectPeopleDirectory): PeopleDirectory {
  const identityKey = (identity: { issuer: string; subject: string }) =>
    JSON.stringify([identity.issuer, identity.subject]);
  const identityCounts = new Map<string, number>();
  for (const person of directory.people)
    for (const key of new Set(person.identities.map(identityKey)))
      identityCounts.set(key, (identityCounts.get(key) ?? 0) + 1);
  const { me, members } = directory;
  const current: CurrentPerson =
    me.status === "linked"
      ? { status: "linked", personPath: me.person.path }
      : me;
  return {
    current,
    ...(directory.account.personSettingsUrl
      ? { settingsUrl: directory.account.personSettingsUrl }
      : {}),
    people: directory.people.map((person) => ({
      name: person.name,
      path: person.path,
      // Membership only describes records linked to an account; someone
      // without one (or an agent note) is neither a member nor a former member.
      ...(members && person.identities.length
        ? {
            activeMember: person.identities.some((identity) =>
              members.some((member) => sameIdentity(identity, member)),
            ),
          }
        : {}),
      ambiguousIdentity: person.identities.some(
        (identity) => identityCounts.get(identityKey(identity)) !== 1,
      ),
    })),
  };
}
