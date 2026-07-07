# Design Direction: Listening Manuscript

The chosen design direction is Listening Manuscript.

Readex should look like a serious reading desk with audio intelligence, not like a podcast dashboard wearing a book costume.

## Layout

Desktop first:

```text
+-------------+----------------------------------+----------------------+
| Library     | Reader                           | Inspector            |
| Search      |                                  |                      |
| Books       |  Chapter title                   | Selected word        |
| Bookmarks   |                                  | Definition           |
| Settings    |  Paragraph text                  | Translation          |
|             |  Highlighted sentence            | Notes                |
|             |  Paragraph text                  | Saved examples       |
+-------------+----------------------------------+----------------------+
| Book / chapter | sentence timeline | prev | play | next | speed | export |
+--------------------------------------------------------------------------+
```

Mobile later:

- reader first
- bottom audio controls
- inspector as a sheet
- library as a separate tab or drawer

## Signature Element

Use an audio margin beside the reader text.

The audio margin is a slim vertical rail with markers for sentences or passages. The active marker matches the active sentence highlight. Clicking a marker seeks to that sentence.

This keeps playback spatially connected to the text instead of pushing all audio state into a generic waveform.

## Highlighting

Playback highlighting is sentence by sentence.

The active sentence can use a subtle warm highlight, not a neon marker smear. Previous and next sentences may get very light contextual emphasis only if it improves orientation.

Word-level highlighting is not part of playback. Word interactions are click/selection based.

## Palette

- Paper: `#FBFAF7`
- Surface: `#F1EFE8`
- Ink: `#171713`
- Muted ink: `#6D6A60`
- Cobalt action: `#245BFF`
- Spoken highlight: `#F7D86B`
- Learning mint: `#8DD7B8`
- Danger: `#B94A48`

Use cobalt sparingly for active controls and focus. Use spoken highlight only in the reader.

## Typography

- Reading text: `Literata` or `Source Serif 4`
- UI text: `Inter`, `Geist`, or `Satoshi`
- Time/status data: `IBM Plex Mono`

The reader text should be excellent at long-form reading. UI typography should stay quiet and precise.

## Component Rules

- Keep the reader surface visually unframed.
- Avoid card soup.
- Use cards only for book items, popovers, dialogs, and repeated list records.
- Keep the bottom player slim and stable.
- Use icons for playback and tool controls.
- Use text labels when a command would be ambiguous.
- Every interactive icon must have a tooltip or accessible label.

## Tooltip / Inspector

Word click behavior:

- quick popover near the word for definition and actions
- optional right inspector for richer learning details

The word popover should never block playback controls or shift the text layout.
