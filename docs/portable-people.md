# People and assignments

This feature is implemented on the coordinated `feature/portable-people`
branches. The candidate contracts and SDK are vendored for reproducible builds;
none of this publishes contracts or deploys Connect automatically.

## Using it

1. Run a compatible Connect server and connect TaskNotes. People access is
   optional: sharing your account identity enables Assigned to me, and sharing
   the member directory marks which people are active members. Declining either
   still lets you use TaskNotes and assign people. Old grants share neither.
2. In Connect collection settings, set up person records (Contact pack 1.2.0) if
   no suitable Person type exists. Under **Your person record**, create a record, link an existing
   Person-compatible contact, or review conversion of a single Contact-only note
   to a type implementing both contracts. Conversion requires compatible mappings
   and normal record edit permission; it does not migrate an entire address book.
3. In task details, use **Assigned to → Choose assignees**. Choices are people
   with unambiguous records; when the member directory is shared, former members
   are labelled and not offered. Existing unresolved or
   former-member assignments remain visible and can be retained or removed.
4. In Search, select **Assigned to me**. Missing, ambiguous or unavailable person
   associations produce an explanation, not a misleading empty task list.
   Connect settings open in another tab; returning from that tab refreshes
   discovery once.

## Portable data

```yaml
assignees:
  - "[[people/Alex Rivera]]"
```

Assignments are ordinary links to person notes, written in the collection's
link format and declared as a link list in the task type's `collection.links`.
mdbase resolves them with the collection's own link rules, so person notes list
their assigned tasks as backlinks and renames through mdbase or Obsidian keep
them current. Names, emails and membership IDs are never used to match. Person
notes contain editable `name` and optional
`identities: [{issuer, subject}]`. Matching is exact and has no authentication,
membership or permission authority. Local person names are not verified account
names. Sharing a note does not invite somebody or grant collection access.

The model supports custom assignee field mappings, preserves unresolved links on
unrelated edits, uses `[]` to clear assignments, and inherits assignments when
materialising occurrences. Assigned to me asks mdbase which tasks' assignee
links resolve to your person record (`asFile()` in an ordinary query), then
filters before repository pagination; the task editor labels each saved link
with the record mdbase resolved it to. TaskNotes never reimplements resolution.
Discovery uses the Connect SDK's `people.directory()`, which reads every Person
implementation and page and resolves the account once for every app. Partial
failures are unavailable rather than guessed matches; invalid records are
reported without hiding everyone else. The app never builds links from the
identity issuer; it uses the server's person settings URL. Saving a task writes
`assignees` only when assignments changed, and unreadable hand-edited values
are left untouched. Contract-view
queries omit `includeBody`; the semantic query API rejects that concrete-record option.

## Integration and verification

- Durable application access goes through `TaskRepository`; Connect metadata and
  projected records use the pinned provider-neutral SDK, not direct provider URLs.
- Canonical candidates: task contract rc.5, task pack rc.16/type v4, model rc.13,
  spec rc.5, `mdbase.person` 2.0.0. Published predecessor artifacts are unchanged.
- SDK: `@mdbase-dev/connect` 0.1.0-beta.114 from the registry (Connect `62242c21`).
- Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:conformance` and
  `pnpm build`. The vendored catalog supports local `pnpm manifest`; remote
  `pnpm contracts:sync` requires publishing the new catalog first.
- Cross-repository checks cover real Contact pack installation/conversion,
  signed consent and SDK discovery through an isolated local daemon.
- Disposable hosted LAB checks on 2026-09-14 passed explicit consent, contact
  conversion/linking, self/member discovery, assignment persistence/recovery,
  Assigned to me inclusion/exclusion and the unlinked-person explanation.
  Unpublished catalog requests alone used a browser-served candidate fixture;
  authentication and hosted operations were real. This is partial acceptance,
  not published-catalog or full multi-account/relay acceptance. Fresh person
  creation needs a live retest after an editor form-pattern fix; its unfinished
  deployment must be reconciled before another LAB deployment.

Publish/review the catalog and coordinate compatible Connect and TaskNotes
releases before exposing the new manifests to production users.
