# Opening a collection upgraded from TaskNotes v4

Upgrade the Obsidian plugin to v5 before connecting the collection to the App.
The plugin migrates collection metadata without rewriting task notes. Keep a
backup and use the plugin's collection checks to review any invalid legacy
records; do not narrow the collection schema or silently rewrite notes to make
App setup succeed.

The App recognizes migrated nullable and scalar-coercion schemas for custom
text, number, boolean, date and list fields, including nested `anyOf` unions.
Date-time fields retain their date-time editor. Unknown or ambiguous unions are
not guessed into an editor. Reading configuration does not change the schema or
stored values.

## First connection

Review Connect's **Set up and allow access** prompt. Pack installation and its
provenance lock belong to this one-time, engine-verified consent, not to the
plugin migration. Compatible metadata can still need this initial installation
and App-only views or Scratchpad resources. An install prompt alone does not
mean your tasks need another migration.

Use an App release that supports the upgraded collection's task contract. If
setup reports that the collection requires a newer TaskNotes contract, update
the App and connect again. Do not downgrade the collection or replace its
customized task type with an older starter type. When that failure is returned
to the App, the connection screen shows update guidance instead of the engine's
debug object. Errors displayed inside Connect's separate approval window are
owned by Connect and may still need its own update.

## Rollout checks

App source and deployed App manifests are separate. Before rolling out a plugin
upgrade, compare each target's public `/.well-known/mdbase-app.json` with the
App's generated manifest: required contract versions and digests, provisioned
pack versions, and redirect URLs must match the intended environment. Qualify
ordinary approval and editing against the matching deployed App; a local model
or mocked browser test does not establish remote authorization compatibility.

App deployments are separate from mdbase Connect server releases. The App's
`pnpm deploy:dev` targets LAB by default (or staging with `MDBASE_ENV=staging`),
while `.github/workflows/deploy-pages.yml` owns GitHub Pages and the optional
Cloudflare production deployment. See the repository [README](../README.md).
Connect releases use their guarded signed-bundle staging, acceptance and
production process; neither changing the App manifest nor passing tests deploys
or authorizes a backend release.
