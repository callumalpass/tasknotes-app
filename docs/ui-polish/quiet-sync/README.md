# Quiet, layout-stable sync feedback

Routine pending feedback no longer inserts text into task rows, the task toolbar,
Scratchpad cards, or view source controls. One fixed overlay appears after two
seconds; routine sync is not a live region. Acknowledgement before that threshold
never displays a notice.

Sustained disconnection escalates after five seconds, a prolonged wait after 30.
Rejection, conflict and unknown outcomes appear immediately with polite feedback
and explicit review/read-only check actions. Known problems survive row filtering
or navigation until current write metadata clears them. Changing repositories
resets timers and prevents old check failures from reaching the new collection.

`e2e/write-status.fixture.tsx` supplies public, in-memory presentation data and
controlled write metadata. These images and tests do not qualify native sync.

- `desktop-before.png`: the previous inline pending labels at `e42d90f`.
- `desktop-after.png`: the same fixture with one quiet overlay.
- `mobile-after.png`: the overlay on the touch-phone layout.

The phone baseline's explicit screenshot failed with a Chromium capture protocol
error; its synthetic trace is retained in the workstream scratch evidence. The
phone layout is also covered by geometry assertions, not inferred from an image.

Browser checks cover eight rapid autosaves and acknowledgement without movement
of the title, toolbar or form, sub-two-second silence, delayed disconnection,
polite problems and explicit checks that never resubmit a write. Unit tests also
cover deduplication, filtering, collection changes and late read-check failures.
