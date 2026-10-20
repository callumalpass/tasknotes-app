# Single-run unsigned staging smoke

Smoke branch `smoke/ios-1.0.9-staging` starts at PR286 head651526e. Do not merge it into the release branch. Production pins, release metadata and product Xcode settings stay untouched. This is not a releasable build.

## Before dispatch

Co20:49 authorized preparation and ONE macos-15 workflow run after stgaccept reports the first wave migrated. Confirm the designated standalone control and ONE task-pack account/collection, a known seeded task title, and CP/SDK owners' ordinary compatibility disposition for SDK944 Stage original15eb/beta134 against the actual post-wave target. No SDK/native/helper rebuild.

`ios.yml` is modified only on this branch and is workflow_dispatch-only. It must not be triggered by a new PR. Dispatch the existing `ios.yml` workflow with this branch as ref, once, after all inputs are available. Never rerun it; report the actual outcome to Co.

Inputs: `wave_receipt` (stgaccept report reference), `editor_origin` (owner-supplied exact Stage Editor presentation destination), and agreed unique `task_title`. The offline preparation build uses reserved `https://editor.example.test` solely to compile; it is NOT a runnable/accepted Stage artifact. CI rebuilds with the actual owner input.

Private CI delivery still needs an approved owner path. The proposed repository-secret keys below were absent in the read-only metadata check; do not export the desktop credential helper or copy keyring values as a workaround. Do not put credentials in issues, workflow_dispatch inputs, inboxes or logs.

- `TASKNOTES_STAGE_STANDALONE_EMAIL`, `TASKNOTES_STAGE_STANDALONE_PASSWORD`, `TASKNOTES_STAGE_STANDALONE_COLLECTION`
- `TASKNOTES_STAGE_SEEDED_EMAIL`, `TASKNOTES_STAGE_SEEDED_PASSWORD`, `TASKNOTES_STAGE_SEEDED_COLLECTION`, `TASKNOTES_STAGE_EXISTING_TASK`

These are two explicitly authorized Stage accounts only, never personal/LAB/production credentials. Their exact identity/collection designation comes from stgaccept, not heuristics or the first available collection.

## What the single job does

1. Frozen install of the original staging SDK archive; explicit staging declaration + exact native installation origin; canonical pinned beta129 manifest compiler (old connect-dev beta125 rejects installation_origins). Standard TypeScript, Vite, static-route and no-fixture checks remain. No production build/deploy bypass.
2. Add a disposable XCTest UI target, build unsigned simulator app/runner with CODE_SIGNING_ALLOWED=NO, then use isolated serial simulators for the standalone read-only control and seeded account smoke. Real browser login, account selection, exact existing collection approval and normal native return only. No injected tokens, URL codes or JS evaluation. A missing trusted Stage browser origin stops before typing credentials.
3. On the seeded account only, read the designated known task; create ONE task named task_title, edit its title to `task_title edited`, complete it, wait for save, force-quit/relaunch and verify completion; background/foreground once. No automatic retry of mutations, setup or other fixture writes.
4. Uiopen independently reads that same completed smoke task and edits ONLY its title to `task_title edited web`. The iOS UI waits at most ten minutes for the round trip. Agree the marker/time with Uiopen before dispatch. No second workflow or alternate app deployment.
5. Serially compile released1.0.8 source618a54d with only Stage endpoint/manifest build configuration and the disposable UI-test target. On another simulator, sign in/open using the same designated migrated account; observe the refusal with NO legacy mutation. This is a same-source reproduction, not the unchanged live IPA. A retained pre-wave session is NOT_RUN.

No local Mac is available: Swift/XCTest compilation, simulator/browser accessibility and actual native sign-in remain unverified until the sole authorized macOS run. Source/local tests and an offline web build do not transfer into a runtime PASS.

Only allowlisted phase names and exit codes are uploaded in `smoke-results/*.json`. Raw XCTest logs, .xcresult, credential-bearing xctestrun files, browser-login images and simulator/app storage stay private to the ephemeral runner and are never artifacts. No signing setup, archive/device build, TestFlight, upload, submission, Pages deployment or main/release merge.
