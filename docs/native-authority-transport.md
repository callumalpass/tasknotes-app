# Native authority transport

TaskNotes' publisher/grant origin is `https://app.tasknotes.dev`. Android serves
its packaged assets on that origin. iOS cannot: WKWebView does not permit HTTP(S)
custom scheme handlers, and Capacitor normalizes an unsupported `iosScheme` back
to `capacitor`. Packaged iOS assets therefore use `capacitor://app.tasknotes.dev`.
Setting `iosScheme: "https"` never made those two origins equal.

Connect binds a private-use native callback to its manifest's HTTPS homepage.
The provider requires an exact matching request Origin, in addition to the
credential and grant-key proof. A normal WKWebView fetch sends the asset origin
and fails that check, even after successful authorization. Restarting cannot
repair this mismatch. This was reproduced using the SDK from the 1.0.6 (19) and
1.0.7 (22) IPAs in an isolated WebKit engine with fixture HTTP services.

## Scope and trust boundary

`src/native/authority-transport.ts` installs an iOS-only fetch adapter before
Connect is initialized. Only HTTPS requests under the mdbase authority API with
a Bearer credential and all four authority proof headers use the native bridge.
Everything else retains browser fetch: app assets, authorization/control-plane
calls, unsigned transfers, and connected-computer relay traffic. Web and Android
are not patched. Neither the UI nor `TaskRepository` distinguishes providers.

`TaskNotesAuthorityHttpPlugin`, registered by `TaskNotesBridgeViewController`,
checks the same HTTPS/API/proof scope again. It uses an ephemeral URLSession and
adds the **fixed native publisher origin**, not a caller-selected origin. It
never modifies a proof, credential, target or body. The provider continues to
validate exact origin, proof/key binding, nonce, grant, operations and scope.
There is no provider exemption or browser-Origin relaxation.

Native requests do not share cookies, HTTP credentials or a response cache.
Cookies are excluded from responses. Native bridge call logging is disabled,
since bridge options contain credentials and signed payloads. Network failures
return a generic error without URLs, query parameters, bodies or headers.

Request and response bodies cross the bridge as base64 bytes, preserving JSON
UTF-8 and binary file contents without reserialization. Redirects are refused
in URLSession and in the fetch adapter: a signature for one target is never
forwarded to another target. Responses retain their HTTP status and error body;
server denials are not retried through a less restrictive path.

AbortSignal cancellation rejects with the caller's original reason and cancels
the URLSession task. This preserves Connect's request budgets and its explicit
unknown-write-outcome recovery rules. Cancellation never implies a write was
not accepted. The adapter does not retry writes or change recovery decisions.

## Verification and remaining device work

Regression tests cover scope, platform isolation, exact UTF-8/binary bodies,
HTTP denials, redirects, cancellation, and late completion. Configuration tests
check the supported iOS scheme, canonical native publisher origin, storyboard
and build registration, and the cookie/redirect/cancellation restrictions.
Native compilation is verified by the existing iOS build workflow.

The diagnostic harness must use an isolated local HTTPS fixture and run the
actual adapter with the shipped SDK; a mock that merely changes a header is not
acceptance evidence. Local native-bridge emulation cannot prove physical-iPhone
URLSession behavior or automatic browser return. Device validation must include
hosted collection opening, signed reads/writes, files and sync, saved-grant
reopening, connected-computer access, and reminder registration/delivery.

This fix does not change state or PKCE checks and does not claim to resolve the
separate missing/mismatched-callback report. That still needs a privacy-bounded
iPhone lifecycle trace; never log callback URLs, codes, state or grant tokens.
