# Store screenshots

Captioned App Store and Google Play screenshots, rendered from the real app UI by
`scripts/store-screenshots.mjs`. The store publishers upload the `en` sets with
every release (`scripts/store-media.mjs`), so commit new images here rather than
uploading them in App Store Connect or Play Console; console uploads are
replaced by the next release.

- **App Store**: the iPhone and iPad sets go on the primary locale of the new
  version, before submission. A set is replaced only when its ordered checksums
  differ, and the submission waits until Apple has processed the uploads and
  published their checksums. Other iPhone and iPad sizes on that locale are
  emptied, so Apple scales these instead of showing old images. Locales without
  their own screenshots fall back to the primary locale's.
- **Google Play**: the phone set and the feature graphic go on the default
  language in the release edit, before commit. An image type is replaced only
  when its ordered SHA-256 list differs. Languages without their own graphics
  fall back to the default language's. The 3:4 iPad set is not used for Play
  tablets, where 16:9 or 9:16 is recommended.

`scripts/store-media.mjs` checks each file's size and that it is an opaque RGB
PNG before anything is written; a bad file stops the release with
`store-media-invalid`. Only `en` is uploaded for now.

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

| Directory                | Pixels    | Where it goes                                      |
| ------------------------ | --------- | -------------------------------------------------- |
| `ios-iphone-69/<locale>` | 1320×2868 | App Store iPhone 6.9" (`APP_IPHONE_67` in the API) |
| `ios-ipad-13/<locale>`   | 2064×2752 | App Store iPad 13" (`APP_IPAD_PRO_3GEN_129`)       |
| `play-phone/<locale>`    | 1080×1920 | Play phone screenshots                             |
| `play-feature-graphic`   | 1024×500  | Play feature graphic                               |

All files are opaque RGB PNGs; Apple rejects screenshots with an alpha channel.
The stores show them in file-name order:

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
