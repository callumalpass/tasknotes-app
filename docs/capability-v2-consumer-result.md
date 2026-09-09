# Beta96 v2 consumer integration — 2026-09-09

Integrated authentic development packs into exactly TaskNotes, Planner,
Workouts and Pickle. The source revision is
`43c3dedd61bb44ca497e854702d87ef2c175b954`, package version `0.1.0-beta.96`,
parent-supplied phase `v2-enablement` / contracts `[1, 2]`. These are SHA-qualified
committed-source development packs, not signed Q or npm publication artifacts.

All six source archives matched the supplied SHA-512 and byte sizes; every
consumer copy was checked again. Each consumer's `vendor/mdbase-connect-sdk.json`
contains its exact subset and SHA-512 values. The common filename suffix is
`0.1.0-beta.96-43c3dedd61bb.tgz`.

| Package  |  Bytes | SHA-256                                                            |
| -------- | -----: | ------------------------------------------------------------------ |
| connect  | 188313 | `b830965ef439ead4b4cf36d7f8cae1e099b2d4996f88b496ec896664b48180c8` |
| devkit   |   9245 | `58e1f554003b4cce3289ea523115708fa2c012834e0b16da789172b80c405b99` |
| protocol |  61051 | `9ecb80068a4daae7c10c1fc96012535d17a1988345ee706675dc4a56d1785675` |
| sync     | 100340 | `870f9515baa32c8b2f6e16bc5596f13f64b546eaae2a5d9a750a95b38e0e0fff` |
| pickle   |   9403 | `eca8d7adf5fa013f2af7f85f21af8d6e8639566b35054cfaaaabd024eaa51aee` |
| testing  |   6802 | `e84c7ddcedfc75b54af8c5d9809fa138c5e47a505ea7b3628b268b05ef6d15bd` |

Subsets: TaskNotes connect/protocol/devkit/sync/testing; Planner connect/protocol/sync; Workouts connect/protocol/devkit/testing; Pickle connect/protocol/devkit/testing/pickle.

## tasknotes-app

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

## tasknotes-planner

- Full `pnpm verify`: passed, including formatting, typecheck, lint,
  **11 files / 66 tests**, strict manifest parsing and production build.
- Existing contract-scoped record/schedule and full-collection saved-view CAS
  regression assertions are preserved.

## workout_tracker

- `npm run typecheck` and `npm run build`: passed, including installed
  manifest validation and production PWA build.
- Vitest: **9 files / 43 tests passed** (all original 40 retained, plus one
  v1-only-server authorization rejection and two local timer regressions).
- Both manifest tests passed when counted with `node --test --test-isolation=none`;
  transactional type-pack verification passed (10 resources / 5 contracts).
- Full `npm test` remains failed at the deployment-script test stage. The default
  Node runner reports one failed test file; diagnostic execution without process
  isolation reports **6 failed / 0 passed** assertions because subprocess output
  is empty. Production/configuration rejection exit statuses were observed, but
  the required stdout/stderr assertions did not pass. No assertions were weakened.
  The SDK Vitest tests initially failed 3 / 42 before health fixtures were fixed.

## pickle-android

- Formatting, typecheck and lint passed in `pnpm verify`.
- `pnpm exec vitest run`: **8 files / 49 tests passed**; all original cases retained.
- `pnpm build`: passed, including installed manifest validation.
- Full `pnpm verify` / `pnpm test` remains failed at the manifest-generator tests.
  Diagnostic execution with `node --test --test-isolation=none` exposes **2 failed
  / 0 passed** generator tests: `execFileSync`/`spawnSync` reports `EPERM` with empty
  output. The unit suite and build were therefore run separately.
- pnpm 11's pre-run state check requires the same `CI=true` and writable store
  configuration as installation. Final runs use `pnpm_config_store_dir` and
  `pnpm_config_verify_deps_before_run=error`, so mismatches fail rather than
  silently reinstall. A later frozen reinstall attempt reached supply-chain
  policy revalidation and failed registry lookup (`EAI_AGAIN`); it was stopped.
  No audit waiver was used. Initial offline candidate installation succeeded with
  `--prod=false`; dev tools remain installed and were used by the final checks.

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

Private logs and starting package/lock/provenance snapshots: `/tmp/v2-consumer-sdk-integration-20260909T130351`.

---

# Historical capability-v2 consumer verification — 2026-09-09

Only the TaskNotes app and Planner worktrees were modified. Existing dirty
drafts were preserved. No concrete runtime failure was found in the permitted
checks; no authority groups, SDK pins or native callback routes were changed
in this verification pass.

## Changed in this pass

- `tasknotes-app/docs/capability-v2-migration.md`: current verification and
  explicit beta95-Q versus enabled-candidate pin handoff.
- `tasknotes-planner/docs/capability-v2-migration.md`: same handoff and current
  acceptance limits.
- `tasknotes-planner/src/data/mdbase-repository.test.ts`: verify contract-scoped
  queries/reads/schedule edits and revision guards; add saved-view update
  coverage preserving unrelated views/options and using the current revision.
- `tasknotes-app/docs/capability-v2-consumer-result.md`: this report. No caller
  output path was supplied; this worktree-local path is the fallback.

## Actual commands and results

All pnpm commands used:
`PATH=/home/calluma/.local/share/fnm/node-versions/v24.19.0/installation/bin:$PATH`.
`node --version` returned `v24.19.0` in both worktrees.

| Worktree      | Command                                                         | Result                                                                           |
| ------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| TaskNotes app | `pnpm test`                                                     | 94 files, 535 tests passed                                                       |
| TaskNotes app | `pnpm typecheck`                                                | Passed                                                                           |
| TaskNotes app | `pnpm build`                                                    | Passed; includes manifest generation/validation and static callback routes       |
| Planner       | `pnpm test`                                                     | Initially 65 tests; after regression additions, 11 files / 66 tests passed       |
| Planner       | `pnpm typecheck`                                                | Passed before and after regression additions                                     |
| Planner       | `pnpm build`                                                    | Passed; includes strict manifest parsing and static callback/bundle verification |
| Planner       | `pnpm exec prettier --write src/data/mdbase-repository.test.ts` | Formatted the edited test                                                        |
| Both          | `git diff --check`                                              | Passed                                                                           |

TaskNotes existing tests cover provider-neutral task CRUD, time entries,
revision recovery, saved views, timer reconciliation, explicit notification
opt-in, and real-SDK v2 authorization denial with exact file/setup intent.
Planner tests cover SDK stale-registration consent, denied access and blocked
contract/setup readiness, planning interactions, scoped edits and saved views.
No live or native-delivery claim follows from these fixtures.

Unit/build logs: `/tmp/tasknotes-app-capability-v2-unit.log`,
`/tmp/tasknotes-app-capability-v2-build.log`,
`/tmp/tasknotes-planner-capability-v2-unit.log` (initial 65-test run), and
`/tmp/tasknotes-planner-capability-v2-build.log`. The final 66-test Planner run
and repeat typecheck were captured in tool output.

## Deferred to parent / acceptance blockers

Both drafts still pin beta95-Q `0.1.0-beta.95`, source
`408c67bc10f128e0833f0da62cb3efb9d94657d7`. They are not enabled-candidate
artifacts. Parent must generate the real candidate with `package:consumer`,
replace app connect/protocol/devkit/sync/testing and Planner
connect/protocol/sync tarballs, and update each provenance JSON,
dependency/override pin and lockfile together using actual generated identities,
sizes and hashes. Repeat consumer checks against those exact artifacts.
No fake version, relabeling or dirty Writer source pin was introduced.

Parent live LAB acceptance remains required for fresh v2 consent, stale v1
reauthorization, denial/revocation and recovery without clearing unrelated
persisted state; exact contract/type-pack setup; TaskNotes CRUD/time entries,
files, timer reconciliation and opt-in delivery; Planner dates/dependencies/
statuses and saved-view list/execute/create/update; unavailable authority and
recovery on both hosted and connected-computer collections. Android/iOS
callbacks and actual notifications still require native acceptance.

No commits, pushes, deployments, publications, credentials, live calls,
browser/LAB operations, smoke/deploy scripts, review subprocesses, canonical
checkout edits, other-repository edits, Writer edits or `.ops` edits occurred.
