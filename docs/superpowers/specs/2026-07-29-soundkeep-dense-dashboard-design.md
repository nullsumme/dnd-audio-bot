# Soundkeep dense dashboard redesign

Date: 2026-07-29

## Goal

Rebuild the Soundkeep frontend as a dense, desktop-application-style dashboard that could later be
wrapped in Electron without restructuring. Every existing feature is preserved exactly. The redesign
is presentational and structural: no API, server, or state-layer changes.

## Scope

Rewritten:

- `src/app.css` — design token layer and density scale
- `src/routes/+layout.svelte` — shell, compact header, sticky transport dock
- `src/routes/+page.svelte` — session console
- `src/routes/library/+page.svelte` — audio library
- `src/routes/settings/+page.svelte` — settings
- New view components under `src/lib/components/soundkeep/`

Untouched:

- `src/lib/soundkeep-client.svelte.ts` — the data layer. Every feature already routes through it and
  it has unit-test coverage.
- `src/lib/types.ts`, `src/lib/asset-metadata.ts`, `src/lib/audio-quality.ts`
- Everything under `src/lib/server/` and `src/routes/api/`
- `src/lib/components/ui/` — the shadcn-svelte registry components are used as-is

Non-goals:

- No Electron main process, preload script, or packaging in this change.
- No light theme. The palette stays dark-only; a theme switch would be a new feature.
- No new runtime or dev dependencies. No new shadcn-svelte registry components.
- No new testing framework. Verification uses the existing lint/check/vitest/Playwright/build gates.

## Feature parity checklist

The redesign must preserve all of the following. Each item is verified against the rebuilt UI before
the work is considered done.

Discord and output:

1. Select a voice channel grouped by guild; connect; disconnect.
2. Opus bitrate mode selection (`auto`, 64, 96, 128 kbps) with a separate apply action, pending-value
   display, configured / channel-limit / current-output readouts.
3. Bot status: configuration, gateway ready, voice connection, audio player state.
4. Runtime capabilities: FFmpeg and FFprobe availability.
5. All 14 audio diagnostics values: encoder, configured bitrate, channel limit, current output
   bitrate, packetization delay, missed frames, deferred partial frames, EOF frames padded, stale
   frames dropped, filler frames, cached effects, PCM cache bytes/max, cache hits/misses, cache
   failures/evictions.
6. Live listener count and current bitrate label.

Playback:

7. Play a background track; pause; resume; seek; previous; next.
8. Shuffle toggle and repeat cycle (off → all → one → off).
9. Stop background, stop soundboard, stop all.
10. Per-line background volume and master volume.
11. Authoritative playback position interpolated between polls, honouring repeat and duration.
12. Trigger a soundboard effect without interrupting the background line; a new effect replaces the
    current one; the active effect is visually marked.

Scenes:

13. Create, edit, and delete scenes with name, description, ordered background track selection, and
    effect selection.
14. Activate a scene or the implicit "All sounds" scene; scene selection filters the queue and the
    soundboard.

Library:

15. Drag-and-drop and file-picker batch MP3 upload with a queue, per-file status (queued, uploading,
    added, failed), retry of failed files, remove-from-queue, clear-finished, and overall progress.
16. Display name for single uploads; filename-derived names for batches.
17. Category, placement, mood, icon, and subtitle on upload and on edit.
18. Artwork upload (PNG/JPEG) with preview, and artwork removal.
19. Preview playback of a library asset in the browser.
20. Toggle an asset between background and soundboard placement.
21. Search by name/category/subtitle/mood and filter by placement.
22. Delete an asset.
23. Storage overview: local audio bytes, background asset count, soundboard button count.

Shell:

24. Sidebar navigation between Console, Library, and Settings with an asset-count badge, collapsible
    to icons.
25. Initial-load skeleton, live-state error banner with retry, and setup-attention banner for missing
    token or missing FFmpeg/FFprobe.
26. Toast notifications for successes and errors.
27. Background and soundboard line status indicators.

## Density scale

Today the pages use ad-hoc sizes (`text-[11px]`, `text-[10px]`, mixed card paddings, `h-16` header).
The redesign introduces a token layer in `app.css` and applies it consistently.

- `--titlebar-height: 0px` — reserved space at the top of the shell, so a future Electron frameless
  title bar can be introduced by changing one variable.
- `--row-h: 2rem` — compact list and stat row height.
- `--control-h: 2rem` — compact control height for the dock and toolbars.
- `--text-micro: 0.6875rem` (11px) — the single small-text size, replacing the ad-hoc values.
- `--radius: 0.5rem` — down from `0.75rem`; reads as application chrome rather than marketing cards.
- `--panel` — a surface token for panels nested inside cards.
- `.metric` / `.metric-label` — the label-over-value readout pair used across Settings and the console.
- Numeric slots use `tabular-nums`.
- The existing warm parchment-gold dark palette and the `.meter-bar` pulse animation are kept.

## Console (`/`)

Current layout: a 13rem scenes rail, the soundboard, and a 22rem aside stacking a 16:8 artwork hero,
the transport, the queue, session output, and the activity feed behind a nested scroll. The artwork
hero consumes roughly 200px of vertical space and the aside competes with the soundboard, which is the
page's primary control surface.

New layout at `xl` and above — a three-column grid plus the shell-level dock:

```
+-----------------------------------------------------------------------+
| Session bar:  * Haunted crypt   12 tracks - 8 effects   [+ Add MP3]   |
+--------------+----------------------------------------+---------------+
| SCENES       | SOUNDBOARD                             | OUTPUT        |
| - All sounds | [All] [Weather] [Combat] [Doors]       | listeners  3  |
| - Crypt      |  []  []  []  []  []                    | bitrate  96k  |
| - Tavern     |  []  []  []  []  []                    | [Stop all]    |
|  [edit][del] |  []  []                                | -- ACTIVITY --|
| -- QUEUE ----|                                        | 20:14 Play    |
| Rain   3:40  |                                        | 20:13 Scene   |
| Wind   2:10  |                                        | 20:11 Connect |
+--------------+----------------------------------------+---------------+
| (shell) Rain over stone  << |> >>  x  o  --o-- 1:12/3:40  vol   vol   |
+-----------------------------------------------------------------------+
```

- Left column (13rem): the scene list with the implicit "All sounds" entry, edit and delete actions
  for the active scene, and beneath it the background queue.
- Centre column: the soundboard, with category tabs and the effect button grid. It receives the
  widest column at every breakpoint.
- Right column (18rem): session output as compact stat rows (listeners, bitrate, stop-all) followed
  by the activity feed.
- The 16:8 artwork hero is replaced by a 40px artwork thumbnail in the dock.
- Below `xl` the three columns stack in the order scenes+queue, soundboard, output+activity, and the
  page scrolls normally. Page-level scrolling is retained; the console no longer uses nested
  `overflow-hidden` panes.

## Transport dock

The transport strip lives in `+layout.svelte` as a `sticky bottom-0` element, not inside the console
page, so background playback stays reachable from Library and Settings.

Contents, left to right: artwork thumbnail, track title and subtitle, shuffle, previous, play/pause,
next, repeat cycle, seek slider with elapsed and total time, background line volume, master volume,
and stop-background.

Consequences:

- Master volume is removed from the top header, where it is currently `2xl:`-only, and from the
  console's session-output card. The Settings page keeps its own master output slider.
- The `Background music` screen-reader heading moves from the console's player card to the dock,
  keeping the same text so the existing end-to-end assertion continues to hold.
- When no background source is active the dock shows an idle state with disabled transport controls;
  master volume stays enabled.

## Library (`/library`)

The two-column arrangement is kept on purpose: the end-to-end test fills `#audio-upload` and
`#upload-name` directly on the page, so the upload form stays inline rather than moving into a sheet.

- Left column: the upload panel. The drop zone becomes slimmer, and display name, category,
  placement, mood, icon, and subtitle move into a compact two-column grid. The upload queue, its
  per-file status rows, progress bar, and clear-finished action are preserved.
- Left column, below: the storage overview as stat rows.
- Right column: the asset table. Rows become single-line and roughly 36px tall — category badge, mood
  badge, and file size move onto one line instead of stacking to roughly 70px. The four row actions
  (preview, placement toggle, edit, delete) stay as inline icon buttons with their current accessible
  names; they are deliberately not collapsed into a dropdown menu, because the end-to-end test
  resolves them by button role and name.
- Search input and placement filter keep their current position in the table card header.

## Settings (`/settings`)

- Discord voice: channel select grouped by guild, connect/disconnect. Unchanged in shape.
- Discord audio quality: the `ToggleGroup` of bitrate modes, the three readouts, and the apply button
  keep their current structure and accessible names.
- Bot status, runtime capabilities, and the 14 audio diagnostics values are rendered as `StatRow`
  lists arranged in two columns, replacing the current mix of separator-divided rows and a
  four-column readout grid.
- Master output keeps its own card with a slider on this page, in addition to the dock control. Both
  read and write `masterVolume` on the shared client, so they stay in sync. Settings is the natural
  home for a persistent output level, and keeping it also preserves the `Master output` text the
  end-to-end test asserts.

## Component breakdown

Pages become composition only, roughly 80 to 150 lines each. New components under
`src/lib/components/soundkeep/`:

Shell and playback:

- `transport-dock.svelte` — the dock described above.
- `playback-position.svelte.ts` — a reactive helper module, not a component. It extracts the
  interpolating playback clock currently inline in `+page.svelte` (the `clock` / `observedPosition` /
  `observedAt` triple) so the dock and any future readout share one implementation.

Console:

- `scene-list.svelte`, `scene-editor-dialog.svelte`, `scene-delete-dialog.svelte`
- `soundboard-grid.svelte`
- `queue-list.svelte`
- `output-panel.svelte`
- `activity-feed.svelte`

Library:

- `asset-upload-panel.svelte`
- `asset-table.svelte`
- `asset-edit-dialog.svelte`
- `asset-delete-dialog.svelte`
- `storage-panel.svelte`

Settings:

- `settings/voice-panel.svelte`
- `settings/quality-panel.svelte`
- `settings/bot-status-panel.svelte`
- `settings/capabilities-panel.svelte`
- `settings/diagnostics-panel.svelte`

Shared:

- `stat-row.svelte` — label-left, value-right compact row.
- `asset-icon.svelte` — deduplicates the Lucide icon map currently copy-pasted in both the console
  and the library page.

Boundaries: each component either reads `useSoundkeep()` from context or takes plain props. No
component owns server state, and no component fetches. Dialogs receive their subject and an open
binding from the page that hosts them.

## Data flow and error handling

Unchanged from today. `provideSoundkeep()` runs in the layout, polls `/api/state` every 2.5 seconds,
and exposes derived getters (`backgroundSource`, `soundboardSource`, `visibleBackgroundAssets`,
`visibleSoundboardAssets`, `activeScene`, `totalLocalBytes`, `setupNeedsAttention`). Mutations go
through `run()`, which sets `busy`, refreshes, and toasts. Views read `busy` to show spinners and
disable controls.

Error surfaces stay as they are: the live-state error alert with retry and the setup-attention alert
render in the shell above the routed content; per-action failures raise toasts.

## Verification

1. `npm run lint` — Prettier check.
2. `npm run check` — `svelte-check` against the TypeScript config.
3. `npm run test:run` — existing unit tests. The data layer is untouched, so
   `soundkeep-client.svelte.test.ts` and every server test must pass without modification. Any need to
   change one of those tests indicates an unintended behavioural change.
4. `npm run test:e2e` — Playwright. Preserved selectors: the `data-sidebar` navigation links; headings
   `Session console`, `Soundboard`, `Audio library`, `Settings`, `Discord audio quality`; the
   `Background music` screen-reader heading; `#audio-upload`, `#upload-name`, `#upload-category`; the
   `Add MP3` submit button; the row-scoped `Add <name> to soundboard` and
   `Remove <name> from soundboard` buttons; the `Library selection` trigger; the bitrate radios by
   label; the `Apply bitrate` button; the `Master output` text; and `[data-slot="card"]` filtering by
   heading for the soundboard and audio-quality cards. Where the dock relocation genuinely changes
   structure, the test is updated and each edit is called out rather than silently adjusted.
5. `npm run build` — production build.
6. Manual pass over the 27-item feature parity checklist above.

## Electron readiness

The renderer uses only APIs available in an Electron renderer process: `File`, `Audio`,
`crypto.randomUUID`, `URL.createObjectURL`, `fetch`. Two hooks are added so a frameless window can be
introduced later without restructuring the shell:

- A `data-app-shell` attribute on the shell root element, as a stable styling and scripting target.
- The `--titlebar-height` variable, which the shell reserves space for and which an Electron build can
  set to a non-zero value to make room for a custom draggable title bar.

A future Electron build would spawn the existing Node server and load it over localhost, so
`adapter-node` remains correct and no adapter change is implied.

## Risks

- The end-to-end test is the main source of breakage. Mitigation: the preserved-selector list above
  is treated as a hard constraint, and the library upload form stays inline specifically to satisfy
  it.
- Moving master volume into the dock removes it from two places it currently appears. The settings
  page keeps a `Master output` section that points at the dock, so the control is still discoverable
  where users expect it.
- Density can harm touch targets. Interactive elements stay at or above 32px in their smallest
  dimension, and the soundboard buttons keep their large square hit area.
