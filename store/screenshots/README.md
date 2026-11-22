# Store screenshots

Captioned App Store and Google Play screenshots, rendered from the real app UI by
`scripts/store-screenshots.mjs`. Store automation does not upload them: Apple
carries listing screenshots forward between versions and Play keeps its listing
assets, so upload a new set by hand when it changes.

## Regenerate

```sh
pnpm store:screenshots                    # build:e2e, then render every locale
pnpm store:screenshots --skip-build       # reuse the existing dist/ build
pnpm store:screenshots --locale en        # one locale
pnpm store:screenshots --device play-phone
```

The script builds the local e2e bundle, serves it with `vite preview` on port
4327 and opens the curated demo collection at `?demo=store`
(`src/demo/store-dataset.ts`). The clock is frozen on Tuesday 24 November 2026,
08:30 UTC, the time zone is UTC, motion is reduced and every request outside the
preview server is blocked, so a run on the same machine reproduces the same bytes.
Font rasterisation can differ slightly between operating systems.

Each frame is the app captured at a phone or tablet viewport, placed under a
caption on the app's own canvas colour and type (Atkinson Hyperlegible). The
script fails if a caption does not fit in two lines.

## Sets

| Directory                | Pixels    | Where it goes                                       |
| ------------------------ | --------- | --------------------------------------------------- |
| `ios-iphone-69/<locale>` | 1320×2868 | App Store Connect → iPhone 6.9" Display             |
| `ios-ipad-13/<locale>`   | 2064×2752 | App Store Connect → iPad 13" Display                |
| `play-phone/<locale>`    | 1080×1920 | Play Console → Main store listing → Phone           |
| `play-feature-graphic`   | 1024×500  | Play Console → Main store listing → Feature graphic |

All files are opaque RGB PNGs; Apple rejects screenshots with an alpha channel.
Upload them in file-name order:

1. `01-today`: Today, with today's tasks and one overdue task.
2. `02-capture`: the New task sheet parsing a date, project and priority.
3. `03-markdown-note`: a task's properties and its Markdown notes.
4. `04-calendar`: the month calendar with the selected day's tasks.
5. `05-board`: a saved board view grouped by status.
6. `06-scratchpad`: Scratchpad in dark appearance, with a task link.

## Captions and locales

Captions live in `captions.json`, keyed by locale. Keep each one short (about six
words), in sentence case and calm in tone; see `PRODUCT.md`. `captureExample` is
the text typed into the New task sheet, so it must use syntax the capture parser
understands in that language. To add a locale, add its captions and run the
script: the browser runs in that locale, so the app renders in it when the locale
is supported.

Change the tasks, notes and dates behind the screenshots in
`src/demo/store-dataset.ts`. Dates there are relative to the frozen clock. The
demo collection is only reachable in the local e2e build.
