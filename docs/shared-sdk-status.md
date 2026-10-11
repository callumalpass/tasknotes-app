# Shared SDK connection guidance

The public entry uses `describeError` for SDK problem titles, messages and suggested actions. SDK-approved update URLs are links; suggestions without an implemented owner action remain text, not pretend buttons. Original opening recovery still requires an explicit, approved original-target selection. No suggested action authorizes replaying a mutation.

Registration refusal details go only to the developer console through the SDK's bounded `developerMessage`. User-facing notices never display raw server messages, error objects or manifest paths. Application-specific stale-gesture fences retain their original currentness guidance alongside the shared description.

A live `collection_migrating`, `update_required` or `account_suspended` problem does not by itself retire an otherwise usable original workspace. Its SDK selection, readiness assessment, generation, records identity and currentness checks must still pass. Local unsaved input remains mounted; actual record operations remain subject to the original SDK's authority. `summarizeStatus(records.status, snapshot.problem)` reports the live problem instead of mislabelling it as an ordinary offline state. The SDK owns resumption; the app does not reopen, replace or replay the connection.

Collection choices receive `snapshot.collections` verbatim. When the SDK reports availability, named unavailable choices remain visible with `describeError(collection)` guidance and cannot dispatch Open. The app does not infer provider availability, query the control plane directly or work around desktop routing.

The SDK6a intake does not yet expose availability in its production public collection list. The SDK successor containing `9c90075ac` owns that propagation. Optional presentation metadata and unit fixtures are not evidence that the current runtime enumerates Private availability, nor evidence of registration, native admission, custody, physical drain or live acceptance.
