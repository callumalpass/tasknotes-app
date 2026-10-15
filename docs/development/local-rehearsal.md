# Isolated local rehearsal build

Local rehearsal is a separate compiled artifact, not a runtime host override.
Vite mode `local-rehearsal` compiles the local build constant. It requires
`VITE_TASKNOTES_ENVIRONMENT=local`, an exact positive-port HTTP 127.0.0.1 app
origin matching the page, and a separately configured exact loopback Editor.
Ordinary LAB/production builds reject local configuration; local builds reject
managed environment selection. Provider-neutral TaskRepository access is unchanged.

## Public compiler inputs

First use mdbase-next's `packages/sdk/scripts/build-local-application.mjs` with
the owned protected stack and shared local trust verifier. This authenticates the
signed per-stack asset and generates a separate public-only SDK source overlay.
Build that overlay and package it with `npm pack`. Copy only the SDK archive into
this checkout's `vendor/sdk-local-<identity>.tgz` (ignored by Git).

Create ignored `vendor/local-sdk-input.json` with public build receipt fields:

```json
{
  "schema": "tasknotes/local-sdk-build/1",
  "sourceCommit": "<40 lowercase hexadecimal SDK source commit>",
  "archive": "vendor/sdk-local-<identity>.tgz",
  "archiveSha256": "<64 lowercase hexadecimal archive SHA256>",
  "trustAssetSha256": "<64 lowercase hexadecimal signed public asset SHA256>",
  "runtimeSha256": "<64 lowercase hexadecimal actual compiled WASM SHA256>"
}
```

Never copy the stack signer, KMS keys, credentials or environment file here.
The archive and receipt contain only public source, trust context and compiled
assets. They are trusted build inputs, not runtime discovery or grant authority.
Managed builds never inspect them or choose their local SDK alias.

## Compile and inspect

```sh
rpnpm --pull dist run build:local http://127.0.0.1:48271 http://127.0.0.1:48272
```

The build command sets the actual Vite variables before compilation, generates
and validates the ordinary web-only manifest at that exact app origin, verifies
the archive receipt, resolves ordinary locked crypto dependencies, and bundles
the real local SDK/Worker/SQL/WASM. It does not substitute source fixtures or
inject runtime environment values. Default SDK native assets retain their
existing committed integrity pins and managed trust module.

`dist/local-build-receipt.json` records public app/editor origins and SDK identity.
Serve only your own dist at the configured origin; use an isolated browser/profile.
An archive hash or successful build is not collection readiness: original genesis,
custody, native CPP, ordinary source/provider, retention/archive, and same-runner
byte comparisons remain required. The older explicit LAB-only native loader stays
fail-closed and is not used as a local fallback by the public SDK startup path.
