import type { JsonObject, MdbaseConnection } from "@mdbase-dev/connect";
import { requireConnectOutcome } from "../cloud/outcome";
import {
  buildPeopleDirectory,
  personFromProjection,
  type Person,
} from "../domain/people";

/** Query canonical projections across every implementation and every page. */
export async function readPeopleDirectory(
  connection: MdbaseConnection<JsonObject>,
  signal?: AbortSignal,
) {
  const [identityResult, memberResult, descriptionResult] = await Promise.all([
    connection.people.current({ signal }),
    connection.people.members({ signal }),
    connection.describe({ signal }),
  ]);
  const identity = requireConnectOutcome(identityResult);
  const members = requireConnectOutcome(memberResult);
  const description = requireConnectOutcome(descriptionResult);
  const contract = description.contracts.find(
    (candidate) =>
      candidate.id === "mdbase.person" && candidate.version === "1.0.0",
  );
  const people = new Map<string, Person>();
  for (const implementation of contract?.implementations ?? []) {
    for await (const result of connection.queryPages(
      {
        contract: {
          id: contract!.id,
          version: contract!.version,
          type: implementation.typeName,
        },
        includeBody: false,
      },
      { signal, pageSize: 200 },
    )) {
      const page = requireConnectOutcome(result);
      for (const record of page.results) {
        const person = personFromProjection(
          record.path,
          record.frontmatter ?? {},
        );
        const previous = people.get(person.path);
        if (previous && JSON.stringify(previous) !== JSON.stringify(person)) {
          throw new Error(
            `Conflicting Person contract mappings for ${person.path}`,
          );
        }
        people.set(person.path, person);
      }
    }
  }
  return buildPeopleDirectory(
    [...people.values()],
    identity,
    members,
    connection.collectionId,
  );
}
