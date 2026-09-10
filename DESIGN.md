---
name: TaskNotes mobile
description: A quiet mobile task surface derived from the mdbase standards-document visual system.
colors:
  paper: "#FFFFFF"
  paper-soft: "#FAFBFC"
  ink: "#20242C"
  ink-soft: "#505965"
  ink-muted: "#77818E"
  line: "#E6EAF0"
  line-strong: "#CDD3DC"
  accent: "#356F96"
  danger: "#974D4A"
  success: "#4F735D"
dark-colors:
  paper: "oklch(17.5% 0.012 255)"
  paper-soft: "oklch(20% 0.013 255)"
  paper-raised: "oklch(21.5% 0.014 255)"
  ink: "oklch(92% 0.008 255)"
  ink-soft: "oklch(78% 0.01 255)"
  ink-muted: "oklch(67% 0.012 255)"
  line: "oklch(29% 0.012 255)"
  line-strong: "oklch(40% 0.014 255)"
  accent: "oklch(73% 0.09 238)"
typography:
  title:
    fontFamily: "Atkinson Hyperlegible"
    fontSize: "32px"
    fontWeight: 700
    lineHeight: 38
  heading:
    fontFamily: "Atkinson Hyperlegible"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 25
  body:
    fontFamily: "Atkinson Hyperlegible"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 23
  label:
    fontFamily: "Azeret Mono"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 16
rounded:
  control: "6px"
  sheet: "12px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
---

# Design System: TaskNotes mobile

## Creative north star

**A personal working notebook.** TaskNotes retains mdbase's paper, blue-black
ink, and precise language, but prioritizes daily decisions over visible
configuration. Task titles lead, supporting metadata explains rather than
competes, and notes preserve the thinking behind the work.

The physical scene is a person checking or capturing work on a phone in normal
daylight or after dark, often one-handed and between other activities. This
requires a high-clarity surface with stable controls and no visual ceremony.

## Color

Use paper across the application. Paper-soft may distinguish a true secondary
surface such as the navigation bar or read-only metadata region. Lines group
rows and fields. Accent is reserved for focus, selection, links, and active
navigation. Semantic colors always appear with a word, icon, or position.

Dark mode uses deep blue-black paper rather than pure black. Raised surfaces
remain close to the canvas, dividers become visible through lightness rather
than saturation, and accent and semantic colors become lighter to retain AA
contrast.

Stored priority colors decorate a swatch, not the label's ink. Keep selected and
unselected text legible without rewriting users' colors.

`#808080` is a data-layer compatibility value used when parsing legacy task
color metadata and in its fixtures. It is not an interface color.

## Theme contract

TaskNotes offers System, Light, and Dark under More. System follows the device
appearance; an explicit choice is stored locally as `mdbase:theme` and applied
before first paint. Components consume canvas, surface, surface-subtle, text,
text-soft, text-muted, border, border-strong, accent, success, warning, and
danger roles rather than fixed palette values.

## Storage trust contract

Every collection choice names its mdbase authority in plain language. Hosted
collections require connectivity; connected-computer collections require that
computer to remain reachable. A completed write has been accepted by that
authority. TaskNotes never presents browser or device storage as another copy
of the collection, and it does not imply offline availability. Portability is
visible through Markdown paths and collection information without exposing
transport details in ordinary task flows. Known unavailability stays visible across
the workspace and detail, even when a cached read succeeds; retry and connection
settings remain available.

## Typography

Atkinson Hyperlegible carries headings, task titles, fields, dates, section
labels, and explanatory copy. Azeret Mono is reserved for technical state,
collection identifiers, and Markdown paths. Preserve platform text scaling and avoid
text smaller than 11 points.

The semantic type scale is intentionally small: 32px page titles, 20px section
headings, 17px controls, 16px body text, 14px supporting copy, and 12px mono
labels. Operational text never falls below the label role. Context-specific
display sizes above body text are reserved for task titles, modal headings, and
the capture plus; ordinary component text uses the nearest semantic token.

## Layout

Views are edge-to-edge pages with 20-point horizontal insets. Repeated tasks
are rows separated by one-pixel rules, not cards. Section spacing is generous;
row spacing is compact. The bottom navigation is flat and separated by one
rule. Detail editing uses an ordinary scrolling form instead of nested panels.

```text
TODAY                         Tue 21

○  Prepare project brief
   10:00 · work
──────────────────────────────────
○  Review mobile storage plan
──────────────────────────────────

+  Add a task
──────────────────────────────────
Today             Search       More
```

## Components

- Task rows use a 48-point minimum height and a conventional completion circle.
  The title's effective target is at least 44px high, separate from completion,
  date, and action controls. Search explains observed non-title matches with
  concise labels such as “Matched in notes.”
- Secondary buttons are text or lightly outlined controls. The persistent
  mobile capture button uses the blue accent fill with contrasting canvas text:
  one unmistakable primary action, not a page full of competing buttons.
- Inputs use the current surface with a bottom rule or a complete one-pixel border when their boundary needs to be explicit.
- Focus uses the muted blue accent and remains visible without adding a heavy glow.
- Persistent selection uses an accent label, icon, check, or soft fill. Do not
  enclose selected controls in accent-colored borders; reserve accent outlines
  for keyboard focus.
- Loading uses skeleton rows that preserve the final layout.
- Empty states name the next useful action in one sentence.
- Mobile bottom navigation shows the first three configured destinations beside
  Browse. Editable focus alone never hides navigation; keyboard-aware changes
  require observed viewport occlusion. Browse contains additional destinations,
  Manage views, and Settings. Tab dismisses Browse and continues outside it;
  arrow keys belong to the menu only while focus is inside.
  Fresh collections begin with Today, Upcoming, and Scratchpad; existing choices
  and migrated navigation preferences remain intact. Manage views separates the ordered destinations shown in
  navigation from the complete catalog. Reordering is an intentional mode with
  drag and keyboard/button alternatives; any saved view or built-in tool may
  occupy the first, Home position. Catalog membership uses explicit Add/Added
  language. Built-in tools and saved views remain distinct, saved
  source paths are quiet metadata, and search plus All/In navigation/Editable
  filters keep large collections manageable. Secondary edit, duplicate, and
  delete operations live in an overflow menu rather than competing with the row.
- Scratchpad separates task creation from outline lifecycle. A compact contextual
  header leaves most of the viewport to the notes. The current capture target is
  the final card in the same fixed-height scrolling feed as older items. The
  wide feed keeps its scrollbar at the page edge while centering spacious note
  cards. On wider screens, when the current card fits, it opens vertically
  centered; long cards fall back to keeping the active capture area near the
  bottom. On phones, the current card follows the Visual Viewport boundary so
  it stays immediately above an overlaying onscreen keyboard without returning
  to vertical re-centering. Intentional upward scrolling reveals history, and
  loading older items preserves the visible position. Each file is a lightweight note card;
  this boundary stays stronger than the rules between rows inside it. Explanatory
  chrome and separate Add task/Add note buttons are omitted: the trailing outline
  row is the capture affordance. Every card can switch between the structured
  Outline editor and its exact Markdown source through a visible Outline / Write
  text switch. Settings controls the default mode for new, empty notes; existing
  content keeps its compatible editor without being rewritten. Older documents load explicitly, expand into the full editor, and
  may remain open together. Typing `[[` offers collection-record suggestions in
  both editors; an exact link becomes a linked row only when it resolves to an
  actual task, while links to other record types remain editable note content.
  Create task notes converts only chosen drafts in place; New note preserves the
  exact current outline without creating tasks. An expanded historical note can
  Resume as current: pending edits to both notes save first, the selected note
  retains its identity and contents, and the displaced current note becomes the
  newest history entry.
  Safe raster images added through the compact capture panel, feed-wide drop
  target, file picker, mobile camera picker, or clipboard become independent
  feed cards even when an editor is focused. Image cards resolve lazily, can
  collapse to a dated summary, and removing one keeps its collection file.
  Collection-scoped local UI preferences retain expanded historical notes and
  collapsed images across reloads and New note transitions. Opening Scratchpad
  or starting a new note focuses its trailing current capture row. Expanded
  images are centered without enlarging small source images. Outline menus may
  escape card borders instead of being clipped and open upward when the lower
  feed or viewport edge leaves insufficient room.
- Scratchpad Markdown mode is a writing surface, not a code panel: proportional
  prose, generous line spacing, a bounded reading width, and monospace only for
  code. A small, keyboard-accessible formatting row preserves the selection and
  ordinary undo. Save status stays quiet but visible, including on phones.
  Instructional footers, placeholder prose, and word counts are omitted.
  Formatting is explicit; autosave preserves the exact Markdown source.
- Outline text and linked-task titles wrap within the text column with hanging
  indentation. Editable rows grow with their content; controls stay aligned to
  the first line. Wrapping does not split nodes, and Enter creates the next item.
- Scratchpad draft-task rows use toggleable portable Markdown checkboxes;
  checked drafts convert into the collection's first completed status. Desktop
  rows keep a direct task-to-note control. Phone rows reserve width for writing:
  conversion and individual task creation live in the row menu, with dragging,
  outdent, indent, and add-child controls in the focused-row toolbar. Leading
  row controls have 44px targets. Linked rows expose the same task-actions menu
  used by task lists, and nested branches can collapse. Loaded history appears
  without fading its readable text.
- Task actions use one vocabulary in lists and detail. On phones they appear in
  a modal bottom sheet; wider layouts use an anchored keyboard menu. Ordinary
  tasks expose the complete action set without a generic “More” layer.
- A recurring occurrence exposes only occurrence-safe actions first. Anything
  that changes the series sits behind an explicit “Repeating task actions”
  boundary.
- Destructive task actions require confirmation and remain recoverable for 30
  seconds.
- Disclosure rows use a title, a plain-language current-value summary, and the
  same chevron treatment across capture, task editing, views, and settings.
- Every writable saved view exposes a pressed-state Manual order sorting option
  and Edit view in a quiet View options disclosure. Manual sorting directly
  enables list handles, including when reopening a saved view; there is no
  separate reorder mode. Switching it off restores the other sort rules without
  deleting stored task ranks. Selecting a different primary sort in the editor
  also hides handles. Partial results expose Load remaining tasks before ordering
  is enabled; stale or incomplete reads never permit rank writes. Boards retain
  direct spatial arrangement.
- Grouped lists have accessible collapsible sections, expanded by default.
  Explicit collapse choices are local preferences scoped to collection, view,
  and section. Manual sorting keeps sections collapsible and reveals empty drop
  destinations. Moving into a collapsed section expands that destination. Large
  manually sorted lists keep measured windowing rather than rendering every row. There is no special
  overdue-review workflow or automatic hiding of overdue work. Projects likewise
  have collection/view-scoped collapse choices, visible counts, and a compact
  jump selector that expands and focuses the chosen project.
- Scheduled and Due retain visible labels, including when both dates occur on
  a row. Routine status/priority defaults recede; custom meaningful values stay
  available. Completion circles do not use a legacy default status color.
- Task detail leads with a title-level completion control and the note body.
  Schedule and status have a compact, wrapping disclosure summary; advanced
  properties and the backing Markdown record remain inspectable. Returning to
  the list restores the invoking control and scroll position.
- Desktop saved-view capture retains focus after successful creation. Phone
  saved views with creation defaults have one persistent contextual Add task
  button instead of a second inline capture field; the shared capture sheet
  retains view creation defaults. Calendar day taps browse the selected day;
  timed selection still starts capture. The calendar toolbar does not duplicate
  the phone capture button.
  Keep adding tasks supports consecutive capture. The sheet follows the visual
  viewport above an overlay keyboard.
- Capture shows the interpreted title and editable/removable date tokens.
  Explicit property edits survive subsequent title typing. The complete draft
  remains visible while saving and survives a rejected write; it clears only
  after authority acceptance. Date shortcuts preserve an existing time. Closing
  an accepted capture sheet announces Task added with an Open action, without
  moving the current view. This confirmation has no action timeout, yields to
  deletion recovery, and clears on navigation or replacement.
- Calendar More opens a readable, opaque panel with 44px controls, bounded to
  the calendar surface and viewport above navigation. The covered calendar grid
  is temporarily inert, not the whole application. Internal Tab stays within
  the panel until its boundary; Tab then dismisses and continues outside.
  Escape returns to More. Opening another overlay retires the imperative panel
  and transfers its return-focus target rather than leaving competing owners.
- View editing has one compact Preview disclosure. On phones, Layout initially
  summarizes the chosen layout so filters are reachable without passing every
  layout tile. Planner is explicitly an external app before saving. Ordinary
  pages and editors reflow at 320px with 200% root text; deliberate board and
  calendar scrolling stays local rather than widening the document.
- A kanban board consumes the remaining usable viewport. Its horizontal
  scrollbar stays at the bottom of the screen while columns scroll within that
  surface.

The radius scale is 0 for page structure and fields with bottom rules, 6px for
ordinary controls, menus, notices, calendar events, and drag surfaces, and 12px
for modal sheets. Circular icon and completion controls remain circular. The
26px mobile Add task control is the only capsule exception: its silhouette and
visible label make the persistent primary action easy to identify in the thumb
zone.

## Signature detail

Task details may reveal the backing Markdown path in a single quiet mono line.
This is functional evidence of portability, not permanent technical chrome.

## Motion

Use 150 to 220 millisecond ease-out transitions only when state changes need
orientation. Completing a task may fade and reposition the row. Respect reduced
motion and avoid entrance choreography.
