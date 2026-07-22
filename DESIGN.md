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

**A pocket standards notebook.** TaskNotes mobile borrows mdbase's white
paper, blue-black ink, pale rules, literal labels, and generous page-level
space. It applies them to a mobile workflow where task rows stay compact and
controls remain familiar.

The physical scene is a person checking or capturing work on a phone in normal
daylight, often one-handed and between other activities. This requires a light,
high-clarity surface with stable controls and no visual ceremony.

## Color

Use paper across the application. Paper-soft may distinguish a true secondary
surface such as the navigation bar or read-only metadata region. Lines group
rows and fields. Accent is reserved for focus, selection, links, and active
navigation. Semantic colors always appear with a word, icon, or position.

## Typography

Atkinson Hyperlegible carries headings, task titles, fields, and explanatory
copy. Azeret Mono is reserved for dates, compact section labels, sync state,
collection names, and Markdown paths. Preserve platform text scaling and avoid
text smaller than 11 points.

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
- Inputs are white with a bottom rule or a complete one-pixel border when their boundary needs to be explicit.
- Focus uses the muted blue accent and remains visible without adding a heavy glow.
- Loading uses skeleton rows that preserve the final layout.
- Empty states name the next useful action in one sentence.

## Signature detail

Task details may reveal the backing Markdown path in a single quiet mono line.
This is functional evidence of portability, not permanent technical chrome.

## Motion

Use 150 to 220 millisecond ease-out transitions only when state changes need
orientation. Completing a task may fade and reposition the row. Respect reduced
motion and avoid entrance choreography.
