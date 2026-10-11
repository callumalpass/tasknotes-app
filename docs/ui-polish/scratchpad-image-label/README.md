# Scratchpad image action

The Add image action was an icon with only a hover title and accessible name;
its neighboring New note action already had visible text. Touch users could not
read its purpose without opening it. DESIGN.md specifies both as borderless text
actions, so Add image now includes its label in the existing contextual toolbar.

Both actions have 44px targets. The toolbar can wrap for 320px / 200% root text;
no feed width, note indentation, editor or upload behavior changes.

## Verification

Fourteen local browser checks passed: light/dark, desktop/390px/320px with 200%
text on desktop and touch projects, visible labels, independent 44px targets,
no document overflow, unchanged writing width, panel toggling and the existing
review-dialog focus regression. The image-capable fixture uses synthetic demo
data; it does not qualify native uploads or authorization. The original held
protocol fixture correctly disabled Add image without its file capability, so
it was not used to claim a working capture panel.

The six screenshots use fixture-only CSS to restore the previous icon-only
presentation and 38px action sizing for the before images. They are controlled
comparisons, not historical production images. At 200% text, the scrolling feed
was moved to the toolbar before capture; the toolbar wraps instead of narrowing
the note.

- [Desktop before](1440-before.png) / [after](1440-after.png)
- [Phone before](390-before.png) / [after](390-after.png)
- [320px / 200% before](320-before.png) / [after](320-after.png)
