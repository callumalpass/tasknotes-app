# Sign-in label layout

The SDK's unpaired first-visit action has no leading Plus icon. Its label used
the 24px icon column and wrapped even in a wide button. Iconless actions now
use a flexible label column with the arrow at the trailing edge. The disabled
opening label keeps its existing full-width span.

The welcome heading can also wrap long words at 320px / 200% text, avoiding
horizontal document overflow without reducing the user's text size.

`e2e/welcome-layout.fixture.tsx` renders the real connection view with an inert
signed-out snapshot: no SDK session, credentials, popup or account action.
Browser checks cover 1440px, 390px and 320px / 200% text in both projects,
including label line count, arrow bounds, 44px targets and opening state.

The before images restore only the old button grid via a fixture-only style
override; the after images use the committed CSS. The 320px images are scrolled
to the action so its label remains visible.
