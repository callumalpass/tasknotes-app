# People and assignments

This feature is implemented on the coordinated `feature/portable-people`
branches. The candidate contracts and SDK are vendored for reproducible builds;
none of this publishes contracts or deploys Connect automatically.

## Using it

1. Run a compatible Connect server and approve TaskNotes' explicit People access
   when connecting. Old grants do not inherit identity/member permissions.
2. In Connect collection settings, install Contact pack 1.1.0 if no suitable
   Person type exists. Choose **Your person** to create a record, link an existing
   Person-compatible contact, or review conversion of a single Contact-only note
   to a type implementing both contracts. Conversion requires compatible mappings
   and normal record edit permission; it does not migrate an entire address book.
3. In task details, use **Assigned to → Choose assignees**. Choices are active
   members represented by unambiguous person records. Existing unresolved or
   former-member assignments remain visible and can be retained or removed.
4. In Search, select **Assigned to me**. Missing, ambiguous or unavailable person
   associations produce an explanation, not a misleading empty task list.
   Connect settings open in another tab; returning refreshes discovery.

## Portable data

```yaml
assignees:
  - person_2c1343ec-cac1-4d58-98c9-41736f4de7db
```

Assignments reference stable `mdbase.person` IDs, never filenames, emails or
membership IDs. Person notes contain editable `name` and optional
`identities: [{issuer, subject}]`. Matching is exact and has no authentication,
membership or permission authority. Local person names are not verified account
names. Sharing a note does not invite somebody or grant collection access.

The model supports custom assignee field mappings, preserves unresolved IDs on
unrelated edits, uses `[]` to clear assignments, and inherits assignments when
materialising occurrences. Filtering happens before repository pagination.
Discovery reads every Person implementation and page; partial failures and
conflicting projections are unavailable rather than guessed matches.

## Integration and verification

- Durable application access goes through `TaskRepository`; Connect metadata and
  projected records use the pinned provider-neutral SDK, not direct provider URLs.
- Canonical candidates: task contract rc.4, task pack rc.13/type v2, model rc.12,
  spec rc.4. Published predecessor artifacts are unchanged.
- SDK source/provenance: `vendor/mdbase-connect-sdk.json` (Connect `4253d59704eb`).
- Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:conformance` and
  `pnpm build`. The vendored catalog supports local `pnpm manifest`; remote
  `pnpm contracts:sync` requires publishing the new catalog first.
- Cross-repository checks cover real Contact pack installation/conversion,
  signed consent and SDK discovery through an isolated local daemon. There has
  been no live LAB or hosted-provider acceptance deployment for this initiative.

Publish/review the catalog and coordinate compatible Connect and TaskNotes
releases before exposing the new manifests to production users.
