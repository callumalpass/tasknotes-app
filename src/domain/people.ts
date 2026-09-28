/** A person record; assignments are links that resolve to its path. */
export interface Person {
  name: string;
  path: string;
}

/** How the signed-in account resolves to a person record in this collection. */
export type CurrentPerson =
  | { status: "linked"; personPath: string }
  | { status: "unlinked" }
  | { status: "ambiguous"; paths: string[] }
  | { status: "invalid"; paths: string[] };

export interface PeopleDirectory {
  people: Array<
    Person & {
      /** Undefined when the member directory was not shared or the record has no linked account. */
      activeMember?: boolean;
      /** Another record claims the same account. */
      ambiguousIdentity: boolean;
    }
  >;
  current: CurrentPerson;
  /** Where the account manages its person record, when the server offers it. */
  settingsUrl?: string;
}
