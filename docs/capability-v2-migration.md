# Capability v2 migration — release held

Production intent includes this consumer, but the release sequence remains:

1. Qualify and deploy Connect beta.95 readers, which permit fresh **v1 only**.
2. Qualify and deploy a subsequent v2-writer release with beta.95 as its rollback predecessor.
3. Complete consumer acceptance, then release TaskNotes through its normal protected paths.

Do not trigger web, development Pages, Android or iOS deployment before those
gates. In particular, merging main triggers web deployment. SDK support for v2
is not evidence that the deployed server permits v2 issuance.

## Preserved authority

TaskNotes requests seven required intent groups, including `records.delete`,
and all six independently represented required file actions. It does not request
`offline.replica`. Setup authority comes from unchanged provisions, not a
capability alias. Notification delivery remains explicit opt-in, never a
prerequisite for application readiness. The reminder manager checks
`background.schedule` before requesting permission. File access remains through
provider-neutral APIs.

The application session lets the SDK derive authority from the declaration; it
does not override it with legacy operation lists. Existing v1 grants must follow
the explicit authorization flow, not silently become v2 grants or fall back from
v2 to v1. Live stale-grant/recovery acceptance is still required.

## Current beta96 v2 candidate provenance

The active SDK pins now use authentic `0.1.0-beta.96` SHA-qualified development
packs from committed product source
`56ed32ffde0544ca497e854702d87ef2c175b954`, supplied by the parent at
`/home/calluma/projects/mdbase-connect/.ops/artifacts/v2-sdk-56ed32ffde05`.
The parent generated these with `pack-consumer-sdk.mjs` for phase
`v2-enablement`, supporting capability contracts `[1, 2]`.
These are **not signed Q artifacts or an npm publication**.

The existing vendor subset is preserved. Every copied archive was checked against
the supplied manifest's byte length and SHA-512, and its package version was
checked as `0.1.0-beta.96`. `vendor/mdbase-connect-sdk.json` records the new
revision, filenames, sizes and SHA-512 values. Dependency and transitive override
pins are updated together; package-manager installation regenerates the lockfile.
No archive is patched or relabelled and no package dependency is added.

The beta95 account below is historical, superseded for active pins by this
candidate. Release remains held: the parent owns rollout ordering, live/native
acceptance, and repinning immutable final release artifacts before consumer
publication if required. Existing v1 sessions remain retained; updated consent
requires explicit reauthorization without silent conversion or fallback.

## Historical beta95 provenance

The previous pins were **beta95-Q**, not enabled-candidate artifacts. Consumer
v2 enablement is authorized in the coordinated cycle, but the parent owns core
issuance and SDK generation. At that stage, the parent needed to supply the actual enabled-candidate
`package:consumer` output, then update the connect, protocol, devkit, sync and
testing archives, `vendor/mdbase-connect-sdk.json`, dependency/override pins and
`pnpm-lock.yaml` together. Preserve the generated artifact versions and record
their actual source revision, sizes and hashes; do not relabel beta95-Q or pin
dirty Writer source. Repeat these hermetic checks against those exact artifacts
before live acceptance.

Connect, protocol, devkit, sync and testing use actual beta.95 tarballs packaged
by the product repository's supported `package:consumer` command from clean,
committed source `408c67bc10f128e0833f0da62cb3efb9d94657d7`.
`vendor/mdbase-connect-sdk.json` records the exact source, filenames, sizes and
SHA-512 hashes. Dependencies, overrides and `pnpm-lock.yaml` were updated
together; unrelated dependency versions were preserved.

These are locally built, source-bound SDK packages—not signed container images
or published npm release artifacts. Original beta.94 provenance remains in Git
history; no old artifact identity was reused.

## Validation

With Node 24.19.0, frozen installation, manifest generation and the vendored
protocol's manifest validator passed. Parent verification passed formatting,
typechecking, lint, all 535 unit tests, coverage/layer thresholds, conformance
checks and production build. Real-SDK tests exercise capability evaluation and
signed v2 authorization requests against a stubbed denial response, including
exact file actions and provision-derived setup. They do not establish live
server compatibility.

The non-live relay fixture now includes provision-derived setup authority, but
browser e2e, actual Connect authorization/revocation/stale-grant acceptance, and
Android/iOS checks remain pending. No consumer publication or deployment has
occurred. Generated public manifests remain gitignored; release origins are
selected through the existing generator options.

## Coordinated consumer verification — 2026-09-09

With Node 24.19.0, `pnpm test` passed 94 files / 535 tests; `pnpm typecheck`
and `pnpm build` passed. Build includes generation, the installed protocol's
manifest validator and static callback routes. Existing provider-neutral tests
cover task create/read/update/delete, revision recovery, time entries, saved
views, timer reconciliation and explicit notification opt-in. SDK tests cover
v2 authorization denial with exact file actions and provision-derived setup.
No concrete runtime failure was found, and no additional authority was granted.
These checks use fixtures, not live collections or native delivery.

Parent LAB still needs fresh and stale-grant consent, denial/revocation and
recovery without clearing unrelated state; task CRUD and time entries; timer
reconciliation and actual opt-in delivery; file actions and saved views on hosted
and connected-computer collections; and Android/iOS callback and notification
acceptance. No browser, LAB, deployment or publication ran in this verification.

## Beta96 candidate integration results — 2026-09-09

- `pnpm test`: **94 files / 535 tests passed** after updating the health fixture.
- `pnpm typecheck`, lint, formatting, production build and installed manifest validation: passed.
- `pnpm test:coverage`: 535 passed; existing overall thresholds passed.
- `pnpm test:coverage:layers`: application and domain thresholds passed (domain: 162 tests).
- `pnpm test:conformance:mdbase`: passed.
- `pnpm test:conformance` failed at the wrapper's `spawnSync` with `EPERM`.
  Direct execution of the same installed conformance runner with
  `node --test --test-isolation=none` and the same adapter passed **4,982 tests,
  1 skipped, 0 failed** (4,983 total; unsupported extended profile skipped).
  This does not turn the failed wrapper command into a pass.

The installed beta96 SDK checks `/health` for
`application-authorization-v2-issuance` before fresh v2 authorization. TaskNotes,
Workouts and Pickle hermetic transport fixtures now model that endpoint; they
still assert exact signed intent and denial. Workouts additionally verifies a
v1-only server returns `capability_contract_incompatible` without an authorization
request or navigation. No production application source, authority declaration,
retained-session migration, or native route changed in this integration pass.

All checks used Node `v24.19.0` via the requested PATH. Initial cache writes
failed with `EROFS`; existing package-manager caches were copied into the private
log directory under `/tmp`, then offline installation succeeded in all four
worktrees (`pnpm install --no-frozen-lockfile --prod=false --offline --store-dir …`
or `npm install --include=dev --offline --cache …`). Lockfiles were regenerated
by package managers, with formatting restored where required. Every unrelated
package/snapshot lock entry is structurally unchanged from the starting draft.
No dependencies, audit waivers or timeout increases were introduced.

These are local fixture/unit results, not live browser, daemon, or native
acceptance. Parent acceptance still needs fresh registration and explicit v1
reauthorization, retained valid v1 grants, denial/revocation and recovery, exact
contract/setup and readonly view behavior, typed records and revision guards,
TaskNotes/Planner saved views, Workouts timers, and actual opt-in notifications
and opaque Pickle wakeups across the supported providers and native callbacks.
Parent owns release ordering and immutable final artifact repinning before
publication if required. Reader, bundled clients and canonical Connect were not
edited; no agents, browser operations, credentials, live service acceptance,
commits, pushes, publishing or deployments were used.

Private logs: `/tmp/v2-consumer-sdk-integration-20260909T130351/tasknotes-app`.
