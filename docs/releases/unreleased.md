# Unreleased

- 1.0.9: When mdbase moves a collection to its new sync service, show mdbase's
  own explanation instead of a generic error. Offer "Update TaskNotes" (opens the
  update link in the iOS and Android apps; saves open drafts and reloads on the
  web) where a retry could never succeed. While a collection is being upgraded,
  wait calmly and check again automatically with backoff, keeping open work on
  screen. Other errors are unchanged.

- Offer a TaskNotes update when you return to an old tab. Save task details and notes before reloading; keep the page open when a draft, pending save, or protected edit needs attention.

- Fixed native iOS hosted-collection access failing after successful authorization
  because the bundled webview origin did not match the grant's publisher origin.
  Signed authority requests now use a proof-scoped, cancellable native HTTPS
  transport, retaining exact-origin and callback validation and refusing redirects
  or ambient cookies. Web, Android and connected-computer relay traffic are
  unchanged.
- Corrected iOS scheme configuration and native-runtime regression coverage.

Physical-iPhone validation is still required. This does not claim to fix the
separate missing/mismatched authorization callback error in issue 205.
