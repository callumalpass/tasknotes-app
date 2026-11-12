---
name: TaskNotes mobile
description: A quiet mobile task surface derived from the mdbase standards-document visual system.
colors:
  paper: "#FCFDFE"
  paper-soft: "#F5F7FA"
  ink: "#182029"
  ink-soft: "#49515A"
  ink-muted: "#687077"
  line: "#E4E6E9"
  line-strong: "#C6CBD0"
  accent: "#1D66A7"
  danger: "#A04038"
  success: "#2A7449"
dark-colors:
  paper: "oklch(17.5% 0.012 250)"
  paper-soft: "oklch(20% 0.013 250)"
  paper-raised: "oklch(21.5% 0.014 250)"
  ink: "oklch(92% 0.008 250)"
  ink-soft: "oklch(78% 0.01 250)"
  ink-muted: "oklch(67% 0.012 250)"
  line: "oklch(29% 0.012 250)"
  line-strong: "oklch(40% 0.014 250)"
  accent: "oklch(74% 0.11 250)"
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
sections and fields. Accent is reserved for focus, selection, links, and active
navigation. Semantic colors always appear with a word, icon, or position.

The palette is one hue family plus two semantic colors. Ink, paper, lines,
and the accent blue share hue 250; neutrals carry almost no chroma, so paper
reads as white rather than tinted, and the accent is the only blue the
interface itself draws. Danger is a plain red and success a plain green, both
at the accent's lightness. Do not introduce a second blue or a tinted surface.

A rounded shape never carries a coloured single edge. Colour on a curved element
fills or outlines the whole shape, and a drop position is its own line beside
the element. A leading bar belongs only on square rows.

Dark mode uses deep blue-black paper rather than pure black. Raised surfaces
remain close to the canvas, dividers become visible through lightness rather
than saturation, and accent and semantic colors become lighter to retain AA
contrast.

Stored priority colors decorate a swatch, not the label's ink. A coloured,
non-default status draws the completion ring itself, with no inner fill, its
lightness clamped to keep 3:1 against the paper; the default status and
uncoloured statuses keep the neutral ring. Keep selected and unselected text
legible without rewriting users' colors.

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
transport details in ordinary task flows. Routine refreshes, including refreshes
on returning to the app, preserve the last known connection state and remain
silent for five seconds. Longer waits show a quiet, non-layout-shifting status
indicator. Known unavailability stays visible as a compact save warning across
the workspace and detail, even when a cached read succeeds or a retry is in
progress. When mdbase reports that the serving computer is offline, show
“Waiting for your computer” instead of task/view loading failures and a stale
retry control. Keep previously loaded work visible; resume read models when the
authenticated change watch becomes active, without a page reload. Do not retry
writes automatically or hide access refusals. Connection settings remain
available. Lifecycle cancellation is not evidence that the collection is
unavailable.

## Typography

Atkinson Hyperlegible carries headings, task titles, fields, dates, section
labels, and explanatory copy. Azeret Mono is reserved for technical state,
collection identifiers, and Markdown paths. Preserve platform text scaling and avoid
text smaller than 11 points.

The semantic type scale is intentionally small: 32px page titles, 20px section
headings, 17px controls, 16px body text, 14px supporting copy, and 12px mono
labels. Shared form fields use 17px on phones and 16px from the 840px desktop
breakpoint, without reducing their 44px minimum target. Field labels use
sentence-case proportional text, not the technical mono scale. Operational text never falls below the label role. Context-specific
display sizes above body text are reserved for task titles, modal headings, and
the capture plus; ordinary component text uses the nearest semantic token.

## Layout

Views are edge-to-edge pages with 20-point horizontal insets. Repeated tasks
are rows, not cards, and are told apart by their completion circle and metadata
line rather than by rules between them. One-pixel rules are reserved for
section, field, and surface boundaries. Section spacing is generous; row
spacing is compact. The bottom navigation is flat and separated by one
rule. Detail editing uses an ordinary scrolling form instead of nested panels.

```text
TODAY                         Tue 21

○  Prepare project brief
   10:00 · work
○  Review mobile storage plan

+  Add a task
──────────────────────────────────
Today             Search       More
```

## Components

- Task rows use a 48-point minimum height and a conventional completion circle.
  Lists use 32px title targets on fine pointers and 44px on coarse pointers,
  with 44px metadata targets throughout. A single-line title plus one metadata
  line stays near 80px on desktop and 92px on touch without reducing typography.
  Completion and overflow retain independent 44px targets. Dates
  and other properties remain directly editable, with no overlapping hit areas.
  Wrapped titles, metadata, and enlarged text grow the row naturally. Plain rows
  retain the 48px minimum; board cards use the same compact property targets as
  list rows, and a property's label and value wrap together in narrow columns. Scheduled
  and Due read relative to today within a week ("Yesterday", "3 days ago",
  "Tomorrow", "Sat") and use a short date beyond it; past dates omit their
  time so overdue rows stay compact. Only a past due date is overdue and takes
  the danger color beside its visible label; a missed scheduled date is a plan,
  not lateness, and stays muted. A
  coloured non-default status draws the completion ring in that color and names
  the status in the control's label and tooltip. On list rows, wrapped
  metadata keeps an even 24px rhythm, and a project, status, or priority value
  truncates where it starts rather than dropping onto a line of its own. The
  starter Today view shows each task's project as quiet, unlabelled metadata.
  An existing Today view without it gets a one-time, dismissible "Show each
  task's project on Today?" offer; the saved view changes only if accepted.
- Completing a task from a row draws the check and sweeps a strike through
  the title once the collection accepts the write; a row that then leaves the
  list lingers 500ms, folds its height away, and is out of the section count
  meanwhile. Keyboard focus moves straight to the neighbouring row. A
  “Completed” notice offers Undo for six seconds (held while hovered or
  focused); Undo also puts back dates a repeating task advanced. Native builds
  give the success haptic. Reduced motion completes immediately.
- On touch, swiping a row right completes (or reopens) the task and swiping
  left opens its actions, which include Schedule today and Schedule tomorrow.
  The revealed side names the action and fills with accent once the swipe
  will act. Buttons keep every action available; board cards never claim
  horizontal swipes. Search explains observed non-title matches with
  concise labels such as “Matched in notes.” Before typing, Search lists up
  to five recent searches and recently opened tasks above the field
  suggestions, each clearable; they are per-device, collection-scoped
  conveniences, and nothing appears without history.
- Secondary buttons are text or lightly outlined controls. The persistent
  mobile capture button uses the blue accent fill with contrasting canvas text:
  one unmistakable primary action, not a page full of competing buttons.
  While the page scrolls down it narrows to its plus, regaining its label when
  scrolling settles or reverses, and lists reserve enough bottom space for
  their last row and its menu to scroll clear of it.
- Inputs use the current surface with a bottom rule or a complete one-pixel border when their boundary needs to be explicit.
  Text fields, selects, and date/time triggers share a type and height rhythm.
  Keep labels close to their fields (4px), separate related fields by 16px,
  and reserve 24px for section boundaries. An expanded disclosure owns its
  bottom spacing; its final field group must not add a second empty band.
  Compact settings selectors use the same proportional type as other fields.
- Focus uses the muted blue accent and remains visible without adding a heavy glow.
- Persistent selection uses an accent label, icon, check, or soft fill. Do not
  enclose selected controls in accent-colored borders; reserve accent outlines
  for keyboard focus.
- Loading uses skeleton rows that preserve the final layout.
- Empty states name the next useful action in one sentence.
- Row overflow triggers (task rows and Scratchpad outline rows) use faint ink
  at no less than 3:1 against paper and darken on hover, focus, or when open,
  so a column of them recedes behind titles without losing its 44px target.
- Every navigation destination has its own glyph. A saved view's icon follows
  its layout (day-sectioned list, agenda, month calendar, board, planner,
  projects, plain list); the starter Projects and Archive views, which share
  the plain list layout, are distinguished by name. The sidebar, phone tab
  bar, More menu, and Manage views use the same mapping.
- The desktop sidebar leads with the collection switcher and a filled New
  task action, lists navigation destinations, and keeps one row at its foot: labelled Views
  beside icon-only Quick actions and Settings. Destinations scroll between the
  fixed head and foot with no scrollbar, fading into the foot when more follows;
  they reorder in place by dragging or with Alt+Up/Down; moving one to the top makes
  it Home. Because the
  sidebar already shows navigation order, desktop Views shows the ordered
  list only while Reorder is active. Views leads with search and saved views,
  unpinned ones first, and shows a view's file path as a tooltip.
- Mobile bottom navigation shows the first three configured destinations beside
  More. Tab labels scale with system text until the tab width is reached and
  never split a word across lines. Editable focus alone never hides navigation; keyboard-aware changes
  require observed viewport occlusion. Phones keep no collection bar above the
  work: More leads with the open collection, which goes to Collection settings
  to switch, then additional destinations, Manage views, and Settings. Tab
  dismisses More and continues outside it;
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
- Settings groups choices by who they affect: Collection, Account (when a
  private account exists), Reminders, On this device, Collection behavior
  (shared through the collection), and About & help. Device and shared
  sections name their scope. Phones show the sections as a list, each opening
  as its own page at `/more/<section>`; wider screens show every section with
  a section index, sticky beside the panels from 1100px. Collection leads with
  one card holding the collection name, connection state, counts, Refresh now,
  and Change collection. How tasks are stored, the location, the mdbase format,
  and refresh diagnostics sit in a disclosure that remembers its state.
  Immediately applied on/off settings use switches. Collection behavior is an
  explicitly saved form grouped as New tasks, Repeating tasks, Archive, and
  Links and time tracking; a field appears only when the choice that enables it
  is on. Its unsaved draft survives leaving Settings, is marked in the section
  index or list, and a sticky bar offers Discard and Save changes. Install
  appears once as a dismissible banner and remains under About. Settings has
  no capture control of its own.
- Projects shows a project count beside a compact native "Jump to project"
  picker rather than a full-width field. A sidebar project opens its own page,
  with All projects as the way back. Parents of subtasks are not sidebar
  projects.
- Scratchpad separates task creation from outline lifecycle. A compact contextual
  header leaves most of the viewport to the notes. The current capture target is
  the final card in the same fixed-height scrolling feed as older items. The
  wide feed keeps its scrollbar at the page edge while centering spacious note
  cards. On wider screens, when the current card fits, it opens vertically
  centered; long cards fall back to keeping the active capture area near the
  bottom. On phones, the current card follows the Visual Viewport boundary so
  it stays immediately above an overlaying onscreen keyboard without returning
  to vertical re-centering. Intentional upward scrolling reveals history, and
  loading older items preserves the visible position. Each file is a lightweight note card with
  a hairline border and no rules between its outline rows; the current note
  alone takes the stronger border and a minimal shadow. A note's title and
  toolbar form one header above a single rule. New note and Add image are
  borderless text actions, and Current note is plain accent text, not a pill. Explanatory
  chrome and separate Add task/Add note buttons are omitted: the trailing outline
  row is the capture affordance. Every card can switch between the structured
  Outline editor and its exact Markdown source through a visible Outline / Write
  text switch. Settings controls the default mode for new, empty notes; existing
  content keeps its compatible editor without being rewritten. Older documents load explicitly, expand into the full editor, and
  may remain open together. Typing `[[` offers collection-record suggestions in
  both editors; an exact link becomes a linked row only when it resolves to an
  actual task, while links to other record types remain editable note content.
  Row kind is shown by the checkbox or note icon alone; switching kinds lives
  in the row menu on every layout. Unfocused rows render `[[path|alias]]` links
  as their label; focusing the row shows the exact source.
  Create task notes converts only chosen drafts in place; New note saves the
  exact current note into history and opens an empty current note without a
  warning or creating tasks. A single simple draft converts
  without review; multiple drafts retain review. Conversion Undo restores the
  draft only while its linked note and created task revision remain unchanged,
  preserving later edits with an explicit notice instead of deleting them.
  An expanded historical note can
  Resume as current: pending edits to both notes save first, the selected note
  retains its identity and contents, and the displaced current note becomes the
  newest history entry.
  Each previous note card carries a quiet Note actions overflow menu, available
  collapsed or expanded, whose Delete note action needs no confirmation: the
  card leaves the feed, focus moves to Undo in the notice, and the record is
  deleted after 30 seconds, on Dismiss, or when the screen is left. The current
  note has no such menu.
  Safe raster images added through the compact capture panel, feed-wide drop
  target, file picker, mobile camera picker, or clipboard become independent
  feed cards even when an editor is focused. Image cards resolve lazily, can
  collapse to a dated summary, and removing one (from the card's overflow
  menu) keeps its collection file. Scratchpad dates use the same short
  month-and-day vocabulary as task rows, never seconds.
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
- Keyboard speed is additive and never required. A focused task row shows a
  soft accent fill with a 2px leading bar rather than a box around its title.
  `j`/`k` (and the arrow keys on a row) move between rows; `o`/Enter, `x`, `t`,
  `m`, and `w` open, complete, and schedule the focused task for today,
  tomorrow, or the start of next calendar week through the same mutation paths
  as the menu, with a polite announcement. Delete has no key. Plain keys yield
  to typing, IME composition, modifiers, and any open overlay. Cmd/Ctrl+K opens
  a command palette (navigation, actions, the focused or open task, task
  search) and `?` opens the shortcut sheet; both are modal overlays. Desktop
  shows a quiet Quick actions entry in the sidebar foot. Option lists keep the
  active option in view, and typed letters jump within them. In capture, a
  status or priority name counts only with its trigger, or beside the word
  priority, so ordinary words stay in the title. Rows draw each priority in the
  colour its collection gave it, however many there are.
- Task actions use one vocabulary in lists and detail. On phones they appear in
  a modal bottom sheet; wider layouts use an anchored keyboard menu. Ordinary
  tasks expose the complete action set without a generic “More” layer.
- Coarse-pointer phone rows put compact supporting metadata below the title.
  Individual inline property controls recede behind one 44px properties trigger
  and its editable sheet; completion remains a separate 44px control.
- A recurring occurrence exposes only occurrence-safe actions first. Anything
  that changes the series sits behind an explicit “Repeating task actions”
  boundary.
- Destructive task actions require confirmation and remain recoverable for 30
  seconds.
- Disclosure rows use a title, a plain-language current-value summary, and the
  same chevron treatment across capture, task editing, views, and settings.
- Every writable saved view exposes a pressed-state Manual order sorting option
  and Edit view in a quiet View options disclosure. Manual sorting directly
  enables list handles, including when reopening a saved view. With a fine
  pointer, handles appear on row hover or keyboard focus. Touch layouts hide
  handles so titles keep their width; a pressed-state Arrange tasks option,
  available only while Manual order is active, reveals them. Switching it off restores the other sort rules without
  deleting stored task ranks. Selecting a different primary sort in the editor
  hides rank-ordering handles; writable grouped lists retain cross-section moves
  without changing that sort. Partial results expose Load remaining tasks before ordering
  is enabled; stale or incomplete reads never permit rank writes. Boards retain
  direct spatial arrangement.
- Grouped lists have accessible collapsible sections, expanded by default.
  Day sections lead with Today, followed by Overdue, Anytime, and Later, so a
  long overdue backlog never pushes today's work below the fold. Today itself
  lists dated work only; undated tasks wait in the Inbox.
  The overdue-count link beside Today's date expands the overdue section,
  scrolls to it and focuses its heading control.
  Explicit collapse choices are local preferences scoped to collection, view,
  and section. Writable grouped lists reveal empty drop destinations while
  dragging, including under a non-manual sort. Custom date groups change only
  their grouped date, retaining its time and other task fields, with Undo.
  Moving into a collapsed section expands that destination. Large
  movable lists keep measured windowing rather than rendering every row. There is no special
  overdue-review workflow or automatic hiding of overdue work; the Overdue
  heading carries one quiet Move all to today action that schedules each row
  for today exactly as `t` does (Scheduled moves, keeping its time; Due stays)
  in one batch, with Undo in the notice. When Today and Overdue are empty,
  Today says “Today is clear,” names the next task coming, and links to
  Upcoming; a collection with no tasks says so instead. The Today date shows
  “n of m done” once a task planned for today has been completed. Projects likewise
  have collection/view-scoped collapse choices, visible counts, and a compact
  jump selector that expands and focuses the chosen project.
- Scheduled and Due retain visible labels, including when both dates occur on
  a row. Routine status/priority defaults recede; custom meaningful values stay
  available. Completion circles do not use a legacy default status color.
- Task detail leads with a title-level completion control, then compact wrapping
  chips for status, priority, Scheduled, Due, and project. Each chip opens its
  existing editor; long values truncate without widening the pane. Notes follow
  immediately, then Subtasks and Attachments. More properties starts collapsed
  and retains every secondary and custom field. Existing notes open as rendered Markdown; clicking the text or choosing
  Write opens the source. Empty notes open ready for writing. Save status is
  quiet proportional text beside the task actions. Without attachments,
  Attachments collapses to one row holding its heading and add actions.
  Attach file accepts any file the collection can store. Non-image attachments
  show a quiet file icon, a truncating filename, size and Download; they are
  never embedded in Notes or opened as active content in the app. Raster image
  attachments retain their preview and Insert actions. SVG is download-only.
  Detach removes task membership, not the file from the collection.
  Collection record extensions (normally `.md`) remain owned by the record API;
  provider refusals stay visible. The model currently requires an explicit file
  extension in attachment links, so extensionless names are rejected before upload,
  not silently renamed or stored with a different link format.
  The editor ends with the task's Markdown
  file: its collection-relative path in muted mono, with quiet Copy path and
  Copy wikilink actions (Copy Markdown link when the collection writes
  Markdown links). Copying confirms inline in a polite status that clears
  itself; a failure says “Couldn’t copy” rather than raising a notice. The
  row menu’s Copy submenu offers the same title, link, and path. Returning to
  the list restores the invoking control and scroll position.
- Desktop saved-view capture retains focus after successful creation. Phone
  saved views with creation defaults have one persistent contextual Add task
  button instead of a second inline capture field; the shared capture sheet
  retains view creation defaults. Calendar day taps browse the selected day;
  timed selection still starts capture. The calendar toolbar does not duplicate
  the phone capture button.
  Keep adding tasks supports consecutive capture. The sheet follows the visual
  viewport above an overlay keyboard.
- Capture shows the interpreted title above proportional-type chips. Date chips
  open timing details; date, project, context, tag, repeat, and estimate chips
  are removable; on touch each chip action has a 44px hit area without larger
  visuals. A suggestion list closes once its only match is fully typed,
  and link values show their display label.
  Phrases the parser consumed (dates, times, repeats, estimates, and trigger
  values) take a faint accent tint inside the field itself, drawn on an
  aria-hidden backdrop so the caret and selection stay native. Tints and chips
  follow the last settled reading: typing ahead keeps them steady, a tint grows
  or shrinks in place rather than blinking, removing a chip clears its tint,
  and newly recognized chips ease in. Reduced motion drops the easing.
  Explicit property edits survive subsequent title typing. The complete draft
  remains visible during native capture and survives a refused capture; it
  clears only after a genuine native local result, not authority confirmation.
  Routine sync never inserts a row or changes editor geometry: a single quiet
  overlay appears after two seconds, without a live announcement. Sustained
  disconnection (five seconds), prolonged waits (30 seconds), rejection,
  conflict, and unknown outcomes use polite feedback and explicit read-only
  check/review actions. Known problems survive filtering or navigation until
  current write metadata clears them; collection changes reset the feedback. Date shortcuts
  preserve an existing time. Closing
  an accepted capture sheet announces Task added with an Open action, without
  moving the current view. This confirmation has no action timeout, yields to
  deletion recovery, and clears on navigation or replacement.
- Fine-pointer desktop Month uses single-line 26px bars with 18px title lines;
  available height determines capacity and excess entries remain in More.
  Toolbar and More controls retain 44px targets. Week and Day keep two-line
  titles. Phone months reserve an unwrapped count slot before fitting priority
  dots, with no More
  popover; the dots are indicators hidden from assistive technology, a tap
  selects the day (at least 44px), and the selected day's tasks are listed as
  ordinary task rows beneath the grid. Google events use their calendar tone
  and open the event editor from grid or Agenda entries. On phone Month, they
  also appear as separate controls in the selected-day list; they never become
  task checkboxes or inflate task counts.
- In Agenda and the selected-day list a Google event reads as a row on the task
  rows' grid: a 4px bar in its calendar's tone stands in the completion column
  (outlined when tentative), then the title, then one quiet line of time,
  location and calendar name. It has no filled background. All-day events open
  each day, ahead of all-day tasks; timed events keep their place among timed
  tasks.
- An event says what it does on each of its days instead of repeating its
  hours: "4pm – Fri 10:30am" where it starts (the date instead of the weekday
  when it ends more than a week on), "All day · Day 2 of 3" in between, and
  "Until 10:30am" where it ends. All-day events over several days count their
  days the same way.
- A Google calendar keeps the hue Google gives it, drawn at the lightness and
  restraint of the app's own event tones so it reads on either theme; without a
  colour from Google it takes a tone by its position. Until someone chooses
  calendars, the primary one and those shown in Google Calendar are drawn, up
  to the limit.
- An invitation the person declined stays where Google keeps it, struck
  through and unfilled, and says "Declined" before its time. Working-location
  entries are not events and are not drawn. One calendar that cannot be read
  shows the failure and leaves the other calendars' events in place.
- A timed event lasting twenty-four hours or more is drawn with the all-day
  entries in every layout, as Google Calendar draws it, and names its start
  time where its bar begins. Its times change in the event editor, not by
  dragging: a dragged all-day bar would lose its hours.
- New event is a labelled calendar-plus control beside the calendar's
  navigation; on phones and in the narrow Agenda bar it keeps its glyph and its
  accessible name only, so the navigation stays on one row.
- Agenda and calendar entries use proportional type and the same relative date
  labels as task rows. An entry on a task's due day, when the task is also
  scheduled, carries a quiet "Due" marker; logged time carries "Tracked time".
  Upcoming uses one agenda on desktop and phones, with the ordinary task row's
  completion, properties and actions; timed entries name their time beneath
  the title without a reserved time column. Its sticky week strip follows the
  first-day-of-week preference, shows weekday/date and nonzero counts together, distinguishes today
  and selection, and supports keyboard navigation and drag-to-day rescheduling.
  Overdue work leads the agenda with a count and Move all to today (with Undo),
  rather than being repeated in today's group. Sticky day headings name Today
  and Tomorrow, show nonzero counts, and retain a quiet Add task on the selected
  day and today; other populated days reveal it on hover or keyboard focus.
  Other consecutive empty days share a quiet date-range row;
  Show more days extends the agenda without unbounded empty-day loading.
  Overlapping timed tasks keep separate titles and drag targets, side by side
  when space permits and cascading in narrow lanes. Hover or keyboard focus
  brings a cascaded item forward; full titles remain available in its tooltip.
  Back strips too narrow for a meaningful title show only the card edge until
  hover or focus. Quiet agenda Add task controls overlay the day heading and
  never reserve an empty row or move the list when revealed.
  Short or narrow entries omit their time before compromising their title;
  titles wrap at word boundaries or ellipsize, never through words. Tracked
  time uses its own lane beside planned tasks. Only the all-day row and month
  grid use overflow summaries.
  All six calendar modes live in a compact layout
  disclosure beside date navigation. A calendar view with a capture row has no
  second Add task button in its toolbar. Metadata and wrapped content grow
  naturally. Calendar toolbar, More links, and overflow-panel events retain
  44px targets; desktop grid events remain independently tappable.
- Desktop calendar More opens a readable, opaque panel with 44px controls, bounded to
  the calendar surface and viewport above navigation. The covered calendar grid
  is temporarily inert, not the whole application. Internal Tab stays within
  the panel until its boundary; Tab then dismisses and continues outside.
  Escape returns to More. Opening another overlay retires the imperative panel
  and transfers its return-focus target rather than leaving competing owners.
- View editing has one compact Preview disclosure. On phones, Layout initially
  summarizes the chosen layout so filters are reachable without passing every
  layout tile. An empty Fields shown configuration means Default fields, with
  the same resolved fields listed in the editor and Preview for every layout.
  The view switcher separates destinations from its labelled actions group.
  Planner is explicitly an external app before saving. Ordinary
  pages and editors reflow at 320px with 200% root text; deliberate board and
  calendar scrolling stays local rather than widening the document.
- Board columns holding the empty status or priority read "No status" or
  "No priority". Desktop columns share the available width down to 216px
  before the board scrolls. Phones show one full-width column at a time with mandatory snapping;
  a jump bar above the board names every column with its count and marks the
  visible one.
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

Motion explains change; it never celebrates. Things arrive from where they
belong and leave the way they came, so the work underneath stays oriented.
Exits are quicker than entrances, and everything stays interruptible: a closing
surface is inert immediately and focus returns at once, not when the motion ends.

- Popovers and menus scale up slightly from their trigger (180 ms enter,
  120 ms exit).
- Centred dialogs, such as New task on wider screens, rise and settle.
- Sheets on phones slide up from the bottom edge on the sheet curve (320 ms
  enter, 200 ms exit) while their scrim fades in. Scrims animate their
  colour, never the sheet's opacity.
- Switching views keeps navigation still; the old work fades out and the new
  work settles 6 px upward.
- Where task details replace the work, they push in from the trailing edge and
  pop back. Beside the work, the details panel slides in on its own.
- Completing a task may fade and reposition the row.

Use the `--motion-*` and `--ease-*` tokens and the shared `motion-*`
keyframes in `01-foundation.css`. Overlays keep rendering while they exit
through `usePresence`; route changes go through `transitionNavigation`. With
reduced motion, all of these change state immediately. Avoid entrance
choreography for ordinary content.

When a list's order or membership changes (a completion, reschedule, section
move, or board column move), rows and cards glide 220ms from where they were
to where they now sit, so the eye can follow the task. Re-renders that keep the
order, such as a width change, never move rows. Lists long enough to virtualize
and moves of more than 60 items settle instantly.

While a task is dragged in a manually ordered list or board column, the rows
part with the same glide to open its slot, and the dragged row waits there as
a faded, dashed placeholder; the drop lands exactly where the slot showed.
Board drags carry a lifted copy of the card under the pointer. Virtualized
lists and reduced motion keep rows still and mark the slot with a line.
