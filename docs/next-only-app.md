# Next-only app cutover (development, not a release)

`next/next-only-app` starts from `main` and targets a next-only `main`. The old
`feat/dual-backend` branch is scaffolding, not a shipping candidate.

## First source intake

Native repository/domain/recovery/watch tests are selectively carried from the
approved scaffolding. Main's newer protected-edit review UI is preserved.
The dual-backend account factory, mixed Connect development archives and old
Connect timer-factory intake are not carried. The standalone view compiler is
an immutable, hash-checked **test oracle**, not a next runtime fallback.

`VITE_TASKNOTES_NEXT_ORIGIN` is the placeholder config key. `.env.next.example`
contains no usable default. `requireNextAppOrigin` rejects missing configuration,
legacy/noncanonical origins and mismatched page origins. This helper is not yet
wired into the replacement startup; it does not itself qualify next startup.

## Remaining cutover work

The classic collection entry point and existing legacy dependency graph still
need removal. Replace them with protected installation sign-in, explicit C5
collection/create consent, the native host and `NextTaskRepository`; do not add a
legacy fallback. Carry the qualified dirty-draft Saved UI fix and qualify the
real full startup, not just repository stand-ins. Port necessary people,
reminders, files and views onto actual next APIs; no old timer-factory adapter is
accepted as a next control-plane producer. A build-graph gate must exclude
legacy adapters before this branch can become a release candidate.

Published runtime dependencies and origin-bound manifests/trust/allowlists need
separate qualified pins. The proposed hostname is not approved and is not used
as a production default. No production deployment or mobile submission is
permitted by this source intake.

## Legacy line

The release owner records the actual deployed legacy source/artifact pin in the
coordination workspace. The redirect guard must be based on that deployed line,
not today's main: fresh authenticated backend routing before legacy data/setup,
no credentials or uncertain writes transferred into next, and no automatic
replay. Deployment/redirect promotion needs separate approval.
