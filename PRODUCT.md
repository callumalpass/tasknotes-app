# Product

## Register

product

## Users

TaskNotes is for people who want dependable task management on the web, iPhone,
iPad, and Android while retaining portable Markdown records in mdbase.

The primary context is repeated daily use: capture a task in seconds, see what
matters today, and update its state without understanding storage architecture.

## Product Purpose

TaskNotes provides one dependable interface over hosted mdbase collections and
collections exposed by a connected computer. Tasks remain structured Markdown
records. Web and native clients use the same direct, provider-neutral mdbase
path.

Success means that capture, review, editing, and completion are clear and
dependable; collection availability is understandable; and users continue to
trust that their information is portable beyond the application.

## Brand Personality

Practical, portable, and quietly precise. The application should feel
considered without feeling decorated. Its language is direct and humane, and
its controls recede behind the work. Match the effortlessness of a dedicated
task manager while providing a better home for the notes behind each task.

## Anti-references

Avoid detached SaaS dashboard chrome, gamified productivity, oversized cards,
black primary buttons, mascot energy, gradients, celebratory animation, and
technical storage language in ordinary task flows. Do not reproduce desktop
Obsidian UI at phone scale.

## Design Principles

1. Open into the work. Once mdbase is available, show the selected collection without an extra storage layer.
2. Make authority explicit. A successful write means the selected mdbase authority accepted it. Known unavailability remains visible even when cached reads succeed. Accepted capture is confirmed without forcing navigation or pretending it must appear in the current filtered view.
3. Keep structure legible. Dates, status, priority, and recurrence should scan clearly without becoming a control panel.
4. Reveal portability gently. Let users inspect the Markdown record and collection location when they choose.
5. Use one vocabulary across providers. Hosted and connected-computer collections should behave like the same product.
6. Improve ordinary lists before introducing special workflows. Section
   collapsing is a display preference, not an overdue-processing mode. Preserve
   custom views and existing navigation choices while offering useful daily
   defaults.
7. Keep reminders dependable. Mdbase owns reminder delivery so it does not depend on TaskNotes staying open.
8. Keep capture history available. Scratchpad is a mixed stream of editable Markdown notes and independent image cards, ordered by when notes most recently entered history and when images were created. Its Add image panel accepts drag and drop, multi-file upload, clipboard paste, and the mobile camera picker through one provider-neutral image pipeline. Note titles are optional and explicitly editable; TaskNotes never derives one from outline content, and an untitled historical note shows only its date. Historical notes and image cards can be collapsed, with collection-scoped collapse preferences retained locally across reloads and new-note transitions. A previous note can be resumed as the sole current note without changing either note’s identity, path, title, body, or creation date; the displaced current note becomes the newest history entry. The current note is the final item in the same fixed-height scrolling feed. On wider screens, when it fits, the feed opens with that note vertically centered; long notes fall back to keeping the active capture area near the bottom. On phones, the current note follows the visual viewport and remains immediately above an overlaying onscreen keyboard. Intentional upward scrolling reveals history and loading older items preserves the visible position.

## Accessibility & Inclusion

Target WCAG AA contrast and platform accessibility conventions. All controls
need accessible names, at least 44-point touch targets, dynamic text-friendly
layouts, non-color state indicators, reduced-motion support, and predictable
screen-reader order. Support system, light, and dark appearance settings, and
test all three without encoding task state by color alone. Focusing an editable
field alone must not remove navigation. Ordinary pages and editors reflow at
320px with 200% root text; intentional board/calendar scrolling stays local.
