# TaskNotes Import

Read `README.md` and `docs/implementation-notes.md` before changing import semantics.
This directory supplies the import engine for the root app's lazy `/import`
route. The old browser shell remains a regression harness, not a second
production deployment. The integrated UI uses the root translation guidance.

- Keep Todoist read-only. Never request write/delete scopes.
- Use the shared TaskNotes model catalog and root canonical type pack. Never add a second lockfile, SDK archive, contract copy or custom frontmatter fallback.
- All durable collection discovery, reads, creates and recovery go through this app's create-only `TaskRepository` port and `storage/task-repository.ts` adapter. Do not import the main editor repository or call collection SDK methods from UI/application code.
- Authentication and collection setup use the SDK's explicit reviewed approval/assessment flow. Never automatically apply a changed setup plan.
- Fail closed on unsupported semantics. Do not silently flatten recurrence, dates or hierarchy.
- Never overwrite an existing destination record. Unknown writes require the SDK's original recovery handle, never a replacement create.
- Keep tokens, source payloads, screenshots of real accounts and private LAB evidence out of Git and logs.
- Automated integration must use isolated LAB and disposable `[test]` fixtures, never production. A production-only SDK original cannot be redirected to LAB.
- Preserve the existing TaskNotes styling and interaction copy during structural changes.
- Production uses the main app's Pages deployment and session. Keep callback routes static and redirect-free.
- Run `rpnpm import:check` from the root for finite checks. Browser checks stay local: build the importer, then `pnpm import:test:e2e`.
- Preserve importer qualification in app CI. Do not publish the legacy standalone shell or change remote domains/authorization without an explicit cutover request.
