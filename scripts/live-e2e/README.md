# Live LAB journey harness

Operator-run Playwright checks of ordinary TaskNotes UI against a **qualified,
served LAB build**. These scripts are not part of the default test suite and
must never target production, personal accounts, normal browser profiles, or
unapproved collections. They do not launch or redeploy the preview.

## Safety and state

- Obtain explicit per-operation approval and the release READY packet first.
  An environment variable, successful build, source merge, or this README is
  **not** permission to run a live operation.
- Use one headless browser at a time. Close it immediately after each run.
  Sequential device checks close the first context before launching the next.
  `concurrency.mjs` is a retained historical diagnostic and now refuses execution
  before any browser, credential lookup, or network request.
- Use only provisioned disposable LAB accounts through ordinary portal UI.
  Never sign up again, copy cookies/sessions/journals, use `lab-acceptance`, or
  substitute fixtures for native CRUD acceptance.
- Mutation markers (`*.once.json`) are written exclusively **before** a click.
  A failure spends the marker. Preserve the profile, journal, collection and
  unknown outcome; do not remove/reset markers, change roots to bypass them,
  resubmit, remint, or allocate replacement fixtures without new authority.
- Report identity comparisons as booleans. Credentials are loaded privately
  from the exact keyring locator and only filled into ordinary login controls.
  Never print credentials, account/note/collection IDs, cookies, approval URLs,
  or record traces/HARs of credential-bearing traffic.
- Screenshots/reports/markers belong outside Git, in an owned evidence root.
  The historical default is the workstream's coordination scratch directory;
  `E2E_EVIDENCE_ROOT` can specify another approved absolute root. Changing it does
  not authorize replay of an existing operation. Keep it unchanged for recovery.

## Configuration

Set `E2E_LAB_SCOPE=fresh-disposable-profile` only after obtaining the applicable
GO. This scope flag does not authorize profile reuse or retries.

Credential helpers require operator-supplied private provisioning directories:

- `E2E_PRIMARY_PROVISIONING_DIR`: approved primary account directory containing
  `clients-account-created.json` and `disposable-email.txt`.
- `E2E_SHARING_PROVISIONING_DIR`: already-created secondary account directory
  containing `sharing-account-created.json` and `disposable-email.txt`.

No credential values or account identifiers belong in shell history, this
README, or source. The helpers validate the LAB keyring schema and exact email
binding; they reject missing/ambiguous locators and do not fall back to another
account or perform signup.

`support.mjs` is pinned to historical app 850 / SDK536 readiness.
`interim-support.mjs` is pinned to app d780 / SDK561 and verifies all 54 served
files plus the root index against the release operation packet. Neither is a
READY guard for a later release. Keep historical proofs immutable and add a
separate exact guard for a newly authorized candidate.

The fixed d780 network guards allow the local qualified preview, HTTPS LAB
mdbase subdomains, and **only the exact published LAB log origin** in
`interim.logOrigin`. That origin is already present in the tracked public
`vendor/mdbase-app-lab-trust.mjs`. Do not use a broad Workers domain allowlist or
silently block the genuine bundled log service. Guards record blocked requests;
any guard defect invalidates causal attribution to the product.

## Safe offline checks

From the repository root, with dependencies installed:

```sh
pnpm exec prettier --check scripts/live-e2e/
pnpm exec eslint scripts/live-e2e/*.mjs
# Select an owned directory for synthetic marker tests, not a live fixture.
E2E_EVIDENCE_ROOT="$PWD/.ops/live-e2e-unit" node --test scripts/live-e2e/support.node-test.mjs
```

These tests make no browser, account, or provider calls. Generated `.ops/` state
is local-only and must not be committed.

## Journey map (not a replay queue)

| Scripts                                                                | Purpose                                                                            |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `entry`, `audit-entry`, `diagnose-login`, `approve`                    | Entry, accessibility and ordinary sign-in                                          |
| `browser-flow`, `credentials`, `journeys`, `support`                   | Private binding, one-shot state, redaction, measurements                           |
| `workspace`, `second-device`, `readonly-concurrency`                   | CRUD, recurrence, restart and sequential device readback                           |
| `slow-network`, `calendar-data`, `audit-workspace`                     | Delayed real requests, positive calendar data, responsive/a11y checks              |
| `inspect-sharing`                                                      | Read-only management discovery; does not invite/signup                             |
| `retest-view`, `finish-view-retest`                                    | One synthetic view create/edit/soft-delete with reload readback                    |
| `retest-scratchpad`, `observe-setup-reload`, `resume-setup-scratchpad` | Fresh first-open and separately authorized original setup observation/recovery     |
| `scratchpad-identity-reopens`                                          | Two authorized sequential reopens, existing-DOM portable ID equality               |
| `returning-ux`                                                         | Fresh-profile returning-user flow; separately authorized same-pending continuation |

Many scripts intentionally name the historical owned run or exact GO. Those
fixtures contain spent markers and must **not** be replayed. Another operator
must inspect the CLI guard, acquire a new exact operation packet and configure
an independently approved run before execution. `returning-ux continue-co1842`
is historical, paused authority, not a current runnable instruction.

The active Scratchpad editor is `.scratchpad-current-document`. Its existing
`[data-scratch-input]` attributes encode `portableDocumentID:ephemeralRowID`;
read the prefix before the first colon without typing, changing mode or focus.
Historical articles use `data-feed-key`, which is not the active editor identity.
Equality of two reopened portable IDs and unchanged visible note counts does
not prove a retrospective first-created ID, native UUID/MID or physical durability.

On a failure, preserve the receipt and close the owned browser. Classify harness
selector/credential/origin errors separately from product findings. Completed
operations and ambiguous native results must never be automatically rerun.
