# TaskNotes UI/UX audit

## Product target

TaskNotes already has a calm visual foundation, strong portable-Markdown
behavior, and unusually complete loading, error, sync, and empty states. The
remaining gap to a Todoist-level experience is mostly hierarchy, trust, and
interaction consistency rather than a new visual language.

The storage capability boundary is:

- Every **mdbase** collection supports task notification delivery, whether it
  uses hosted sync or connects directly to a computer.
- **On this device** storage retains reminder details in Markdown but does not
  deliver notifications.
- mdbase is also the recommended option for larger collections because its
  indexed queries and saved views are more performant.

## P1 — Trust, navigation, and accessibility

### 1. Collection choice does not explain the consequential differences

The former collection screen presented two locations without helping people
understand performance, reminder delivery, offline behavior, or browser data
risk.

**Improve:** Make mdbase the clearly recommended choice, compare the durable
benefits in plain language, disclose the local notification limitation before
selection, and add a browser-storage confirmation that explains site-data
loss.

### 2. Phone navigation can grow to five permanent items

Five bottom-navigation destinations crowd labels and reduce reliable touch
targets, especially with longer saved-view names.

**Improve:** Keep at most two saved views directly visible on phones, followed
by Views and More. Put remaining views in the existing Views menu.

### 3. The mobile view editor is too compressed

Two-column layout choices, dense control groups, and a hidden Cancel action
make the editor feel like a desktop form squeezed into a sheet.

**Improve:** Stack layout choices on phones, keep explicit Cancel and Save
actions visible, and retain 44-point targets throughout the sheet.

### 4. Calendar grid semantics and keyboard behavior are incomplete

Date cells are exposed directly under a grid without row semantics. The mini
calendar does not implement standard grid traversal.

**Improve:** Add rows, roving tab stops, Arrow keys, Home/End, and
Page Up/Page Down behavior, including correct cross-month focus movement.

### 5. Focus visibility is inconsistent

Several fields and custom controls suppress outlines. Keyboard users can lose
their place when moving between task properties and popovers.

**Improve:** Use one visible focus treatment for interactive controls. Keep the
quick-capture title field intentionally quieter: caret plus a subtle underline,
without a full rectangular ring in either inline or modal capture.

### 6. Compact controls do not share a target-size contract

Back buttons, date cells, quiet icon actions, editor controls, and menu rows use
different minimum sizes.

**Improve:** Define a shared 44-pixel control token and apply it to menus,
calendar cells, settings, editor controls, and touch layouts.

### 7. Completed content is dimmed as a whole

Whole-row opacity weakens metadata, icons, focus indicators, and contrast in
both themes.

**Improve:** Keep the row at full opacity and communicate completion with
muted text color and a line-through.

## P2 — Hierarchy, semantics, and performance

### 8. Routine defaults add noise to every task row

Values such as Open, Normal, false, and unarchived are technically accurate but
do not help scanning.

**Improve:** Suppress routine defaults in ordinary list rows while retaining
meaningful exceptions and full values in task detail.

### 9. The Organize submenu has uneven text rhythm

Icons, primary labels, and supporting text use competing alignment models,
producing the visibly uneven submenu shown in the audit reference.

**Improve:** Use a two-row grid with the icon spanning both rows, consistent
line-height, muted supporting text, and a balanced centered header.

### 10. Menu drill-ins keep menu semantics when they become forms

Subtask creation and permanent-delete confirmation are not menus, even though
they are reached from one.

**Improve:** Switch to dialog and alert-dialog semantics, focus the safe action
first for deletion, trap focus while modal, and keep menu-item accessible names
free of visual detail text.

### 11. Undefined theme and typography tokens create fragile fallbacks

`--ink-faint` and `--font-mono` are used without definitions in several
components.

**Improve:** Define both centrally and use theme-aware shadow tokens instead of
hard-coded light-theme values.

### 12. Destructive task actions are too prominent

Archive and Delete compete with Back and save status in the primary task
toolbar. The inline delete confirmation does not read as a deliberate modal
decision.

**Improve:** Move Archive/Restore and Delete into a quiet overflow menu. Use a
focused alert dialog with Keep task first, Escape handling, focus restoration,
and keyboard traversal in the menu.

### 13. More mixes unrelated settings into one long stream

Storage, connection, notifications, appearance, views, schema behavior,
portability, diagnostics, and about information compete at the same level.

**Improve:** Group storage, connection, sync, notification delivery, and
switching under Collection; keep Views and Appearance under Preferences; put
task-model and portability controls under a collapsed Advanced group; reserve
About for product identity and version. Hide benchmark tools outside debug
builds.

### 14. Raw ISO 8601 durations leak into normal editing

Inputs such as `P14D` make ordinary concepts like “14 days” feel technical.

**Improve:** Present amount and unit controls. Preserve arbitrary ISO values
behind an Advanced duration disclosure.

### 15. Saved views request up to 50,000 task identities unconditionally

Ordinary list views pay the memory and query cost of calendar identity
expansion even when the renderer does not use it.

**Improve:** Request the identity set only for calendar presentations. Keep
ordinary lists and boards on their executed view rows.

### 16. Multi-value autocomplete does not expose its active option

The visual highlight is not connected to the combobox for assistive
technology, and token changes are silent.

**Improve:** Add stable option IDs, `aria-activedescendant`, a labelled
listbox, and polite add/remove announcements.

### 17. Empty Views has no visible first-use action

The empty copy refers to adding a view, but the only creation affordance is an
unlabelled plus icon in the header.

**Improve:** Add a visible “Create your first view” action and briefly explain
lists, boards, and calendars.

### 18. Desktop often feels like the phone surface widened

Persistent utility controls make rows busy, while the list/detail transition
arrives too late and leaves medium desktop widths underused.

**Improve:** Reveal row actions on hover or focus for fine pointers and move the
deliberate list/detail split to medium desktop widths.

## P3 — Finish and delight

### 19. View editing competes with the page title

The outlined Edit view action and “In navigation” label are stronger than their
frequency warrants.

**Improve:** Use a quiet labelled icon action and remove navigation-state copy
from the working view.

### 20. Search lacks lightweight result feedback

After a search resolves, there is no compact confirmation of result size.

**Improve:** Add a quiet live result count above the rows.

### 21. About reads like an unfinished preview

“Web-native preview” is implementation language, not product information.

**Improve:** Show the semantic app version.

### 22. Capture suggestions use a light-only shadow value

The hard-coded RGB shadow is weaker and muddier in dark mode than the rest of
the token system.

**Improve:** Use the shared theme-aware soft-shadow token.

## Strengths to preserve

- Calm, restrained typography and color with no decorative excess.
- Fast inline capture with useful progressive disclosure.
- Portable Markdown explained without dominating normal task work.
- Strong loading, indexing, sync, conflict, save, error, and retry states.
- Substantial keyboard support in custom date, time, and select controls.
- Focus traps and Escape behavior in the major existing modal flows.
- Reduced-motion support and a healthy light/dark token foundation.
- Lazy loading for heavy editors, calendar code, and Markdown preview.

## Verification matrix

Final acceptance covers:

- collection welcome, browser-local confirmation, local-folder selection, and
  both mdbase connection choices;
- Today, saved lists, Projects, Kanban, full calendar, mini calendar, Search,
  Views, More, task detail, and global capture;
- every menu, submenu, date/time/select popup, view-editor disclosure, discard
  confirmation, delete confirmation, reminder editor, and empty/error state;
- light, dark, and system appearance;
- 320, 360, and 390-pixel phone widths, tablet, and desktop list/detail widths;
- keyboard traversal, focus restoration, accessible names, and 44-point touch
  targets;
- focused component tests, full unit suite, Playwright desktop/mobile suite,
  lint, typecheck, production build, and conformance checks.
