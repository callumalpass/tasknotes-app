# TaskNotes vs Todoist: UI/UX scorecard

Compared side by side on 2026-11-04: Todoist's web app on a real account, and
TaskNotes running the demo collection, both in Chrome at 1280×800 in dark mode.
TaskNotes phone layouts were also checked at Pixel 7 size. Scores are out of 10.

## Round 0: baseline (lead assessment)

| #   | Category                    | What it covers                                       | TaskNotes | Todoist |
| --- | --------------------------- | ---------------------------------------------------- | --------- | ------- |
| 1   | Capture                     | Speed from anywhere, parsing, token feedback         | 8         | 9       |
| 2   | Daily triage                | Today, overdue handling, finishing a task            | 7.5       | 8.5     |
| 3   | Planning ahead              | Upcoming, rescheduling, calendar                     | 7         | 8.5     |
| 4   | List scanability            | Density, metadata hierarchy, priority at a glance    | 6.5       | 9       |
| 5   | Task detail                 | Seeing and changing a task's properties              | 7         | 8       |
| 6   | Navigation and organisation | Sidebar, counts, projects, finding things            | 7         | 8.5     |
| 7   | Keyboard flow               | Reach and discoverability of shortcuts               | 7.5       | 9       |
| 8   | Direct manipulation         | Hover actions, context menu, drag, bulk edit         | 6         | 8.5     |
| 9   | Phone and touch             | Thumb reach, density, gestures                       | 7         | 8.5     |
| 10  | Visual polish               | Type, spacing, consistency, motion, both themes      | 7         | 8.5     |
| 11  | Feedback and trust          | Undo, sync state, errors, loading                    | 8.5       | 8       |
| 12  | Notes and thinking          | Notes, scratchpad, depth behind a task               | 9         | 5       |
| 13  | View flexibility            | Base-compatible views, board, calendar, custom views | 9         | 6.5     |
| 14  | Accessibility               | Contrast, targets, screen readers, reduced motion    | 8         | 7       |
| 15  | Learnability                | First run, empty states, teaching                    | 6.5       | 8       |

Totals: TaskNotes 110, Todoist 115.

## Council rounds

Each member used both apps on their own desktop, against a frozen build, and
scored all 15 categories afresh. Scores are TaskNotes / Todoist out of 150.

| Round | Claude Opus   | GPT Sol       | Muse          |
| ----- | ------------- | ------------- | ------------- |
| 1     | 118 / 120.5   | 120.5 / 125   | 107.5 / 117   |
| 2     | 123 / 120.5   | 114 / 124     | 124.5 / 119   |
| 3     | 125 / 120     | 121.5 / 122.5 | 108.5 / 117.5 |
| 4     | 125.5 / 122   | 123 / 125     | no result     |
| 5     | 129 / 122.5   | 124 / 124.5   | 128.5 / 120.5 |
| 6     | 133 / 124     | 128.5 / 126   | 124.5 / 118.5 |
| 7     | 130.5 / 121.5 | 128 / 126     | 129.5 / 121.5 |
| 8     | 132.5 / 123.5 | 123.5 / 125   | 129.5 / 121.5 |
| 9     | 132 / 122     | 129 / 126.5   | 128 / 118.5   |
| 10    | 132.5 / 122.5 | 130.5 / 125   | 136 / 124     |

A higher total did not always win a round: members weighed categories by daily
use, so Opus (rounds 2 and 4) and Muse (rounds 2 and 6) gave Todoist the verdict
while scoring TaskNotes higher.

## Round 10: final scores

Commit 25ed485. All three members chose TaskNotes, and none called any category
materially behind Todoist.

| #   | Category                    | Opus      | Sol       | Muse      |
| --- | --------------------------- | --------- | --------- | --------- |
| 1   | Capture                     | 9 / 9     | 9 / 9     | 9 / 9.5   |
| 2   | Daily triage                | 9 / 8.5   | 9 / 8.5   | 9.5 / 8.5 |
| 3   | Planning ahead              | 8.5 / 8.5 | 9 / 8.5   | 9 / 8.5   |
| 4   | List scanability            | 8.5 / 9   | 8.5 / 9   | 9 / 8.5   |
| 5   | Task detail                 | 9 / 8     | 9 / 8.5   | 9 / 8     |
| 6   | Navigation and organisation | 8.5 / 8.5 | 8.5 / 8.5 | 9 / 8.5   |
| 7   | Keyboard flow               | 9.5 / 9   | 8.5 / 9   | 9.5 / 9   |
| 8   | Direct manipulation         | 8.5 / 8.5 | 8.5 / 8.5 | 9 / 8.5   |
| 9   | Phone and touch             | 8.5 / 8.5 | 8.5 / 8.5 | 8.5 / 9   |
| 10  | Visual polish               | 8.5 / 8.5 | 8.5 / 9   | 9 / 9     |
| 11  | Feedback and trust          | 9.5 / 8   | 8.5 / 8.5 | 9 / 8.5   |
| 12  | Notes and thinking          | 9.5 / 5.5 | 9 / 5.5   | 9.5 / 5.5 |
| 13  | View flexibility            | 9 / 7     | 9 / 7     | 9.5 / 6.5 |
| 14  | Accessibility               | 8.5 / 7.5 | 8.5 / 8.5 | 9 / 7.5   |
| 15  | Learnability                | 8.5 / 8.5 | 8.5 / 8.5 | 8.5 / 9   |

Todoist was read-only and its native phone app was not observed, so its drag,
bulk and phone scores rest partly on product knowledge. TaskNotes ran in the
demo collection, so real sync, conflict and error states were not reviewed.

## Rules for finishing

TaskNotes passes only when every council member (Claude Opus, GPT Sol, Muse)
independently scores it higher overall after using both apps, and no category
falls behind Todoist in a way the member calls material.

Native strengths are not traded away: Base-compatible views, Scratchpad, the
calendar, Markdown portability, and explicit sync and authority state.
