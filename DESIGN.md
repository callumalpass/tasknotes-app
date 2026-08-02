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

**A pocket standards notebook.** TaskNotes mobile borrows mdbase's paper,
blue-black ink, quiet rules, literal labels, and generous page-level space. It
applies them to a mobile workflow where task rows stay compact and controls
remain familiar.

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

`#808080` is a data-layer compatibility value used when parsing legacy task
color metadata and in its fixtures. It is not an interface color.

## Theme contract

TaskNotes offers System, Light, and Dark under More. System follows the device
appearance; an explicit choice is stored locally as `mdbase:theme` and applied
before first paint. Components consume canvas, surface, surface-subtle, text,
text-soft, text-muted, border, border-strong, accent, success, warning, and
danger roles rather than fixed palette values.

## Local-first trust contract

Every collection choice names two things in plain language: what keeps working
without a connection, and which copy is the source of truth. Hosted mdbase keeps
a durable device copy for offline work and syncs it to the hosted source of
truth. On Android and iOS, device-only mode treats its local Markdown as the
source of truth and does not imply that a missing connection is a problem. Web
browsers require mdbase and never offer browser storage as a collection
authority. A direct computer connection is explicitly connection-dependent.
Portability is a top-level setting, not an advanced implementation detail.

## Typography

Atkinson Hyperlegible carries headings, task titles, fields, and explanatory
copy. Azeret Mono is reserved for dates, compact section labels, sync state,
collection names, and Markdown paths. Preserve platform text scaling and avoid
text smaller than 11 points.

The semantic type scale is intentionally small: 32px page titles, 20px section
headings, 17px body and control text, 14px supporting copy, and 11px mono labels.
The mature stylesheet also contains fine-grained optical adjustments between
0.62rem and 2.35rem for dense task, calendar, metadata, and responsive
hierarchies. Those literals are explicit legacy exceptions until the stylesheet
is extracted into tokens; new UI should use the nearest semantic role rather
than add another value.

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
- Buttons are text or lightly outlined controls. There are no black or saturated filled buttons.
- Inputs use the current surface with a bottom rule or a complete one-pixel border when their boundary needs to be explicit.
- Focus uses the muted blue accent and remains visible without adding a heavy glow.
- Loading uses skeleton rows that preserve the final layout.
- Empty states name the next useful action in one sentence.

The radius scale is 0 for page structure and fields with bottom rules, 6px for
ordinary controls and notices, and 12px for modal sheets. The 26px mobile Add
task control is the only capsule exception: its silhouette and visible label
make the persistent primary action easy to identify in the thumb zone. Existing
calendar, select, and drag surfaces retain optical radii from 2px through 14px
as documented legacy exceptions; new components should use 0, 6px, or 12px.

## Signature detail

Task details may reveal the backing Markdown path in a single quiet mono line.
This is functional evidence of portability, not permanent technical chrome.

## Motion

Use 150 to 220 millisecond ease-out transitions only when state changes need
orientation. Completing a task may fade and reposition the row. Respect reduced
motion and avoid entrance choreography.
