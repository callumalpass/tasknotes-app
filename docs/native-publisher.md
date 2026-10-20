# Protected native Pages publisher

TaskNotes native source **must never merge to main**. The existing manual
`deploy-pages.yml` has an isolated `publisher=native` route. Its default remains
`legacy`; existing main-only GitHub Pages/Cloudflare jobs retain their guards.
Native dispatches never enter those jobs.

## Coordinator prerequisites (not performed by this change)

- Protect `release/native-staging` and `release/native-production`: reviewed
  workflow/source changes, no force-update/bypass. Each source must descend from
  reviewed native base `153494deb68c71d37a3e99f3ef140d874145e2f1`.
- Configure GitHub environments **staging** and **production** with exact matching
  native-branch policies. Production requires explicit Callum approval, required
  reviewer, no self-review/bypass and separate cutover GO. **Do not dispatch into
  an absent/unprotected environment** (GitHub can otherwise create one).
- Make the reviewed workflow dispatch definition available through the existing
  default-registered workflow as needed, without merging native source to main.
- Obtain genuine target-environment SDK originals from TNAPP, with authenticated
  release trust and qualification. Intake their original SDK/UI/protocol archives,
  companion metadata and frozen lockfile on that target release branch. No SDK
  replacement under an old lock, LAB retargeting, repacking or generated trust.
- Independently approve the producer's original archive SHA-256 values and set
  environment variables `NATIVE_SDK_SHA256`, `NATIVE_UI_SHA256`,
  `NATIVE_PROTOCOL_SHA256`. These are public digests, not secrets. Do not populate
  them by trusting consumer companion labels alone. They are the publisher's
  authenticated-original input boundary; it does not replace producer signature
  verification. Missing/mismatched approvals refuse before install/build/upload.
- Environment secrets (existing names only): `CLOUDFLARE_API_TOKEN`,
  `CLOUDFLARE_ACCOUNT_ID`, scoped to the verified account/project `tasknotes-app`.
  Only the publication step receives them. No PR-triggered native jobs.

Current vendored SDK is LAB-only; current UI says `noPublication`. They are not
staging/production inputs. No SDK/lock/trust bytes are changed by this work.

## Exact source and destinations

Dispatch the literal target native branch with `publisher=native`,
`target=staging|production`, and `source_sha=<full lowercase 40-character SHA>`.
The SHA must equal the dispatch workflow SHA, checked-out HEAD and fetched release
head, not merely an old ancestor. Both guard and publish enforce this. Old/stale
SHAs fail rather than silently rebuilding another source.

| Target     | App                                       | Editor                              | Connect                              | Pages channel |
| ---------- | ----------------------------------------- | ----------------------------------- | ------------------------------------ | ------------- |
| staging    | `https://staging.tasknotes-app.pages.dev` | `https://editor-staging.mdbase.dev` | `https://connect-staging.mdbase.dev` | `staging`     |
| production | `https://app.tasknotes.dev`               | `https://editor.mdbase.dev`         | `https://connect.mdbase.dev`         | `main`        |

Both channels belong to project `tasknotes-app`. Pages `--branch=main` selects
its production slot; it is **not** a Git main checkout/merge. Neither native
target has Connect loopback or a LAB app origin. Log origin is taken only from
the independently approved archive's authenticated packaged trust.

## Build, receipt and served verification

`guard` requires clean exact source, approved original archive hashes, matching
companion metadata and actual packaged provenance/trust/native/SQLite members.
It never executes SDK trust modules. The independently approved archive hash
binds provenance, publication-proof digests, no-clock-override verifier and CP/log
bindings to producer originals.

After a frozen install, `prepare` runs the existing build **once**, canonical
strict manifest validation (no allow-local), exact origin checks and full asset
inventory. Built native/SQLite bytes must match the SDK; bundled trust must be
present in JS. No build gets deployment credentials. Generated manifest changes
are expected build outputs, hence Wrangler's explicit dirty-output flag.

`publish` rechecks exact source and the full inventory before upload. It records
the actual Pages deployment UUID from Wrangler 4.114.0's structured JSONL output,
not the short URL prefix. Receipt includes source SHA/tree, SDK/UI/protocol hashes,
packaged trust/provenance and CP/log bindings, trust-bearing JS assets, full built
asset digests, target/channel and deployment identity. Receipt/JSONL live outside
the checkout and are retained even on post-upload failure.

The bounded verifier fetches the actual staging alias/custom domain, not just the
unique preview URL. It compares lengths and SHA-256 of HTML routes, canonical
manifest, webmanifest, all JS (including embedded trust), WASM/native, SQLite and
other public files. Pages control files remain inventoried but aren't fetched;
HTML uses Pages canonical routes and the custom 404 body is checked with 404.
Redirects and auth failures refuse; there is no bypass. Default limits: three
attempts/file, 10 seconds/request, five minutes overall, one-second retry delay.

A served mismatch creates a **failed** receipt and fails the job. There is no
automatic rollback, rebuild, retarget, retry upload or redeploy. A byte receipt
is not native sign-in/grant/readiness/application acceptance.

## Tests and unresolved legacy route

Run `node --test scripts/native-publisher.node-test.mjs` for dependency-free guard,
archive-fixture, inventory, receipt and verifier contracts; the repository's
`test:release` script includes it. Use `rpnpm` for package tests/checks locally.
Use `actionlint .github/workflows/deploy-pages.yml` for workflow validation.

The legacy `callumalpass.github.io/tasknotes-app` publication stays on the
existing main route. Whether to retain that route at native cutover remains a
coordinator/Callum open question; this publisher neither changes nor publishes it.
