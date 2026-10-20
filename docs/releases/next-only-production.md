# TaskNotes iOS 1.0.9 — launch-source candidate

This one release branch starts at the actual launch source
`b7eb693964526de35a054ddf4e950074afb6bc50`, not the older iOS RC line.
The existing `release/ios-next-only-rc` supplies the released 1.0.7/1.0.8 fixes,
native sign-in/upgrade-wait handling, production/candidate build wiring and
MANUAL submission support. The b7 unified collection UI, safe edit recovery
boundary and draft-preserving update reload remain intact.

## Current inputs and remaining preparation

The candidate consumes the already-qualified original LAB SDK944 archive:
`vendor/sdk-dev-eaa4e697-lab.tgz`, source
`eaa4e697fc1198f32fc3714f377342a24c56d985`, SHA-256
`ec8249e19d9d27893ac7ae83b99473a7aad550e4ab54a42dd20786dfd42b8a70`.
TaskNotes keeps its approved original UIfe archive. Native bytes remain the
accepted Product A original, SHA-256
`6984f87d98e29d9f99c6b07f7728f716d1f7b2e3585a74bcc2046ba259a8afab`,
true producer `725d72b2e43b2b744062e055e43feaeb41838399`.
No SDK/native/verifier rebuild or re-attestation is required by this app work.
The SDK source, native producer, qualified verifier and target Connect source
are distinct identities.

The only remaining engineering input is the **production SDK swap plus trust
pin**, after production authorization and delivery by the existing owners.
Steps 1–4 are:

1. Existing owners publish production trust and perform full-chain,
   current-clock authentication privately/OFF-CI.
2. They deliver the authorized production-packaged SDK original retaining
   SDK944 and the accepted native; this app does not rebuild native or create
   another trust protocol.
3. TaskNotes vendors those exact SDK bytes and JSON pin, updates the SDK
   dependency and lockfile, and keeps its app-specific UI unchanged.
4. Fill `vendor/production-trust.pin.json` with the authenticated production
   `trustAssetSha256`, `logOrigin` and SDK pin filename. These three inputs remain
   **null** in this candidate; production environment and control-plane origin
   are fixed. No guessed value, environment override or LAB/staging relabeling.

`pnpm build` / `pnpm verify` use the existing offline production SDK preflight
and must refuse while that pin is null. This is byte binding to approved inputs,
not fresh signature authentication or production GO. Public CI does not acquire
or execute a new trust verifier.

## Candidate CI and native behavior

PR CI runs `pnpm verify:candidate`: release scripts, formatting, types, lint,
coverage/layer thresholds, conformance and the production-configured candidate
bundle. iOS then syncs Capacitor and compiles an **unsigned simulator** app;
Android compiles its debug app. `dist/tasknotes-candidate.json` always records
`releasable: false`. No release, submission or deploy workflow uses this bypass.
The candidate’s LAB SDK cannot become a production release by setting VITE
origins; the actual production SDK archive and trust pin must be swapped.

Native production accepts only `capacitor://app.tasknotes.dev` (including
WebKit’s opaque-origin representation); the publisher remains
`https://app.tasknotes.dev`. Sign-in uses the declared callback and wakes the
original SDK owner. The released 1.0.8 proof-scoped bridge is retained, not
presented as the SDK Worker transport or as native runtime acceptance.

Only typed `collection_migrating` is shown as an upgrade wait. Open work stays
mounted beneath the banner; retry is read-only. Generic fencing or unknown
provenance is not evidence of migration. Task edit and update reload retain the
b7 repository-identity and draft-preservation behavior.

## Release authority

Version is **1.0.9**; Xcode’s default build is **26**, above live build 25.
The release workflow retains its monotonic run-number build and refuses a run
number ≤25. The 1.0.9 metadata remains a draft with **`releaseType: MANUAL`**.
Store-copy/review-account/export declarations require owner approval; they are
not claimed complete by candidate CI. Physical-device/TestFlight acceptance is
not claimed here.

Main merge, signing, upload and submission each require Callum’s explicit
confirmation for that action. Nothing here authorizes deployment or live
account/LAB mutation. Apple approval must not auto-release before the migration
window ends. Use the [five-line runbook](ios/1.0.9-runbook.md).

## Validation

Launch-based candidate, 2026-10-20:

- Remote `pnpm verify:candidate`: **PASS** — 72 release-script tests and one
  existing Rust-authority skip; format/types/lint; 1,748 unit tests in 227 files;
  coverage and layer thresholds; 4,982 conformance tests and one existing skip;
  production-configured candidate build and fixture-exclusion check.
- Focused local fixture browser repairs: **40 PASS / 0 FAIL / 0 SKIP**, desktop
  and mobile, plus 28 focused keyboard/row unit tests. Initial failures and
  diagnostic logs are retained separately, not relabeled as successes.
- An initial full run exposed a mutable generated-manifest test fixture; its
  production fixture is now explicit. A temporary untyped script import was
  removed; final types and the complete candidate command pass.
- Remote e2e-mode build: **PASS**; the full built-preview suite and PR CI are
  recorded in the coordinator handoff when complete.
- Candidate marker: `releasable: false`, `productionTrust: absent`. The three
  production trust-pin inputs remain null; metadata remains draft/MANUAL.

These are app source/fixture/unsigned candidate results, not live native,
account, device, target authentication or production admission. Historical RC
counts are not transferred to this branch. No signing, upload, submission,
production deploy or main merge was performed.
