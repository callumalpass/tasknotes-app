# Web deployment and production gate

`.github/workflows/deploy-pages.yml` verifies the application and browser artifact
before deploying. Pushes to **main** deploy only
<https://staging.tasknotes-app.pages.dev/> through `MDBASE_ENV=staging pnpm deploy:dev`.
That existing script builds for staging Connect and connector port 28486,
validates the artifact, deploys the Cloudflare `staging` branch, and smokes staging.
LAB remains separate and is not changed by this workflow.

## Promote to production

1. Validate the staging commit with a disposable collection.
2. Open **Actions → Deploy Pages → Run workflow**, select branch **main** and
   target **production**. The default target is **staging**, not production.
3. Review the selected commit and approve the protected production environments.
   If main has advanced since staging validation, validate the new commit first.

Production dispatch reruns verification, then deploys and smokes the existing
GitHub Pages surface. Only after that succeeds does it deploy and smoke
<https://app.tasknotes.dev/>. Both production jobs are manual-dispatch-only.
Deployments are serialized per target and are not cancelled mid-deploy.

Every successful production upload is followed by `pnpm test:production-smoke`
in the same job. Cloudflare smoke always targets **app.tasknotes.dev**, including
its production-only embed/header checks; a missing URL variable cannot skip it.
A smoke failure fails the deployment run with an error annotation. The deployment
has already happened: investigate and, if necessary, perform an explicit operator
rollback; there is no automatic rollback.

`.github/workflows/production-smoke.yml` retains pull-request artifact checks,
manual dispatch, and the **six-hour schedule**. Scheduled/manual smoke checks the
canonical **app.tasknotes.dev** origin. The smoke checks shell/PWA/auth/notification
and Connect boundaries, not authenticated CRUD in a real collection.

## Required administrator settings

- Create GitHub environment **tasknotes-staging**, restricted to deployment branch
  **main**. No required reviewers are needed for automatic staging deployment.
- Keep production environments **github-pages** and **cloudflare-pages**, restricted
  to **main**. Add required production reviewers, prevent self-review, and disable
  protection-rule bypass where supported. Manual dispatch is already a code-level
  gate; environment approval provides an additional reviewer gate.
- In **tasknotes-staging** and **cloudflare-pages**, set environment secrets
  **CLOUDFLARE_API_TOKEN** (account-scoped **Cloudflare Pages: Edit**) and
  **CLOUDFLARE_ACCOUNT_ID**. Reuse the existing credential names; no additional
  credential type is introduced. Verification and smoke jobs need no credentials.
- Keep GitHub Pages source set to **GitHub Actions**, and its existing URL
  <https://callumalpass.github.io/tasknotes-app/>. Production retains this surface
  as a prerequisite to deploying the canonical Cloudflare domain.
- Keep Cloudflare Pages project **tasknotes-app**, production branch **main**,
  custom domain **app.tasknotes.dev**, and staging alias
  **staging.tasknotes-app.pages.dev**. Disable separate Cloudflare Git-triggered
  production deployments if configured, otherwise they bypass the GitHub gate.
- Keep `TASKNOTES_FIREBASE_PROJECT_ID` at repository scope if required by the
  existing notification setup; verification has no deployment environment.
  The staging script deliberately clears it for its web-only manifest.
- `CLOUDFLARE_PAGES_ENABLED` and `TASKNOTES_PRODUCTION_URL` are no longer used by
  these workflows: production explicitly deploys Cloudflare and always smokes
  the canonical origin. They can be removed after checking other consumers.
- Enable failure notifications for deployment and scheduled-smoke workflows.
  Smoke is mandatory but does not automatically notify a separate incident system.

These workflows do not configure environments, secrets, reviewers, or Cloudflare
settings. Staging validation is an operator/reviewer responsibility, not an
automated assertion that the same SHA previously passed staging.
