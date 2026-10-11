# Unreleased

- Fixed native iOS hosted-collection access failing after successful authorization
  because the bundled webview origin did not match the grant's publisher origin.
  Signed authority requests now use a proof-scoped, cancellable native HTTPS
  transport, retaining exact-origin and callback validation and refusing redirects
  or ambient cookies. Web, Android and connected-computer relay traffic are
  unchanged.
- Corrected iOS scheme configuration and native-runtime regression coverage.

Physical-iPhone validation is still required. This does not claim to fix the
separate missing/mismatched authorization callback error in issue 205.
