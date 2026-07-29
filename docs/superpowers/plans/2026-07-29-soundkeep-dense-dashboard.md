# Soundkeep Dense Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Soundkeep frontend as a dense, desktop-application-style dashboard with a persistent transport dock, preserving all 27 existing features and the entire server/state layer unchanged.

**Architecture:** A density token layer in `app.css` plus tightened `Card` primitives set the visual scale. The three route pages become thin composition shells over focused view components in `src/lib/components/soundkeep/`. A `sticky bottom-0` transport dock in the layout owns background playback so it stays reachable on every route. All data access continues to flow through the existing `SoundkeepClient` Svelte context — no component fetches or owns server state.

**Tech Stack:** SvelteKit 2 + Svelte 5 runes, TypeScript, Tailwind CSS 4, shadcn-svelte (local `nova`-style components under `src/lib/components/ui/`), `@lucide/svelte`, `svelte-sonner`, Vitest (node environment), Playwright.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-29-soundkeep-dense-dashboard-design.md`. Read it before Task 1.
- **Do not modify** `src/lib/soundkeep-client.svelte.ts`, `src/lib/types.ts`, `src/lib/asset-metadata.ts`, `src/lib/audio-quality.ts`, anything under `src/lib/server/`, or anything under `src/routes/api/`.
- **Do not modify** existing test files except `tests/e2e/dashboard.test.ts`, and that only in Task 8.
- No new dependencies in `package.json`. No new shadcn-svelte registry components.
- Dark theme only. Keep the existing warm palette hex values in `app.css` exactly as they are.
- Every component either calls `useSoundkeep()` from context or takes plain props. No component calls `fetch`.
- Interactive elements stay at or above 32px (`h-8` / `size-8`) in their smallest dimension.
- Run `npm run format` before `npm run lint` in every task — `lint` is `prettier --check .` and will fail on unformatted files.
- Commit after every task. Branch is already `feat/dense-dashboard-ui`.
- These end-to-end selectors are a hard contract until Task 8. Do not rename or remove them:
  - `data-sidebar="menu-button"` links with `href="/"`, `href="/library"`, `href="/settings"`
  - headings (`<h1>`/`<h3>`): `Session console`, `Soundboard`, `Audio library`, `Settings`, `Discord audio quality`, `Master output`, and the screen-reader-only `Background music`
  - element ids: `#audio-upload`, `#upload-name`, `#upload-category`
  - accessible button names: `Add MP3`, `Library selection`, `Apply bitrate`, `Add <name> to soundboard`, `Remove <name> from soundboard`
  - bitrate radios with names `Auto`, `64 kbps`, `96 kbps`, `128 kbps`
  - `[data-slot="card"]` wrappers around the `Soundboard` and `Discord audio quality` headings
  - the library page must contain zero elements with `role="tab"`

---

## File Structure

**Created:**

| File                                                               | Responsibility                                                |
| ------------------------------------------------------------------ | ------------------------------------------------------------- |
| `src/lib/playback-position.ts`                                     | Pure interpolation of playback position between polls         |
| `src/lib/playback-position.test.ts`                                | Unit tests for the above                                      |
| `src/lib/components/soundkeep/stat-row.svelte`                     | Compact label-left / value-right row                          |
| `src/lib/components/soundkeep/asset-icon.svelte`                   | `AssetIcon` name → Lucide component (deduplicates two copies) |
| `src/lib/components/soundkeep/transport-dock.svelte`               | Persistent background transport, seek, volumes                |
| `src/lib/components/soundkeep/scene-list.svelte`                   | Scene selection list plus edit/delete/create triggers         |
| `src/lib/components/soundkeep/scene-editor-dialog.svelte`          | Create/edit scene dialog                                      |
| `src/lib/components/soundkeep/scene-delete-dialog.svelte`          | Scene delete confirmation                                     |
| `src/lib/components/soundkeep/queue-list.svelte`                   | Background queue + `Library selection` picker                 |
| `src/lib/components/soundkeep/soundboard-grid.svelte`              | Category tabs + effect button grid                            |
| `src/lib/components/soundkeep/output-panel.svelte`                 | Listeners, bitrate, stop-all                                  |
| `src/lib/components/soundkeep/activity-feed.svelte`                | Recent server events                                          |
| `src/lib/components/soundkeep/asset-upload-panel.svelte`           | Batch MP3 upload form and queue                               |
| `src/lib/components/soundkeep/asset-table.svelte`                  | Dense asset table with row actions                            |
| `src/lib/components/soundkeep/asset-edit-dialog.svelte`            | Asset metadata + artwork editor                               |
| `src/lib/components/soundkeep/asset-delete-dialog.svelte`          | Asset delete confirmation                                     |
| `src/lib/components/soundkeep/storage-panel.svelte`                | Storage overview stat rows                                    |
| `src/lib/components/soundkeep/settings/voice-panel.svelte`         | Channel select, connect/disconnect                            |
| `src/lib/components/soundkeep/settings/quality-panel.svelte`       | Opus bitrate mode + apply                                     |
| `src/lib/components/soundkeep/settings/master-output-panel.svelte` | Master output slider                                          |
| `src/lib/components/soundkeep/settings/bot-status-panel.svelte`    | Bot status stat rows                                          |
| `src/lib/components/soundkeep/settings/capabilities-panel.svelte`  | FFmpeg/FFprobe stat rows                                      |
| `src/lib/components/soundkeep/settings/diagnostics-panel.svelte`   | 14 diagnostics stat rows                                      |

**Modified:** `src/app.css`, `src/lib/components/ui/card/{card,card-header,card-content}.svelte`, `src/routes/+layout.svelte`, `src/routes/+page.svelte`, `src/routes/library/+page.svelte`, `src/routes/settings/+page.svelte`, `tests/e2e/dashboard.test.ts` (Task 8 only).

---

### Task 1: Density token layer

**Files:**

- Modify: `src/app.css`
- Modify: `src/lib/components/ui/card/card.svelte`
- Modify: `src/lib/components/ui/card/card-header.svelte`
- Modify: `src/lib/components/ui/card/card-content.svelte`

**Interfaces:**

- Consumes: nothing.
- Produces: CSS custom properties `--titlebar-height`, `--row-h`, `--control-h`, `--panel`; Tailwind utilities `text-micro`, `bg-panel`/`text-panel`; classes `.metric`, `.metric-label`. Cards render at `rounded-xl` with `px-4` padding.

- [ ] **Step 1: Add the token block to `src/app.css`**

In the `@theme inline` block, add these three lines immediately after the `--font-display` line:

```css
--color-panel: var(--panel);
--text-micro: 0.6875rem;
--text-micro--line-height: 1.25;
```

- [ ] **Step 2: Add the density variables to `:root` in `src/app.css`**

Replace the line `  --radius: 0.75rem;` with:

```css
--radius: 0.5rem;
--titlebar-height: 0px;
--row-h: 2rem;
--control-h: 2rem;
```

Then add `  --panel: #1c1f1a;` immediately after the `  --card: #171a16;` line.

- [ ] **Step 3: Add the metric utility classes to `src/app.css`**

Append to the end of the file:

```css
.metric-label {
  color: var(--muted-foreground);
  font-size: var(--text-micro);
  line-height: 1.25;
}

.metric {
  font-size: 0.875rem;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  line-height: 1.25;
}
```

- [ ] **Step 4: Tighten the card primitives**

In `src/lib/components/ui/card/card.svelte`, change `'rounded-2xl'` to `'rounded-xl'` inside the `cn(...)` class string. Leave the border, background, shadow and backdrop classes untouched.

In `src/lib/components/ui/card/card-header.svelte`, change `'flex flex-col gap-1.5 p-5'` to `'flex flex-col gap-1 px-4 pt-4 pb-3'`.

In `src/lib/components/ui/card/card-content.svelte`, change `'p-5 pt-0'` to `'px-4 pb-4'`.

- [ ] **Step 5: Verify the tokens compile and the app still builds**

Run: `npm run format && npm run lint && npm run check && npm run build`
Expected: all four succeed. `check` reports 0 errors. If `check` reports pre-existing warnings, note them but do not fix unrelated ones.

- [ ] **Step 6: Commit**

```bash
git add src/app.css src/lib/components/ui/card
git commit -m "feat(ui): add density token layer and tighten card primitives"
```

---

### Task 2: Shared primitives

**Files:**

- Create: `src/lib/components/soundkeep/stat-row.svelte`
- Create: `src/lib/components/soundkeep/asset-icon.svelte`

**Interfaces:**

- Consumes: `text-micro` and `--row-h` from Task 1.
- Produces:
  - `StatRow` props: `{ label: string; value?: string | number; class?: string; children?: Snippet }`. When `children` is given it replaces `value` in the value slot.
  - `AssetIconGlyph` props: `{ icon: AssetIcon; class?: string }`. Renders one Lucide icon. Falls back to `AudioLines` for an unknown name.

- [ ] **Step 1: Create `src/lib/components/soundkeep/stat-row.svelte`**

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils';

  let {
    label,
    value,
    class: className,
    children
  }: {
    label: string;
    value?: string | number;
    class?: string;
    children?: Snippet;
  } = $props();
</script>

<div
  class={cn(
    'border-border/40 flex min-h-(--row-h) items-center justify-between gap-3 border-b py-1 last:border-b-0',
    className
  )}
>
  <span class="metric-label truncate">{label}</span>
  <span class="metric min-w-0 truncate text-right">
    {#if children}{@render children()}{:else}{value}{/if}
  </span>
</div>
```

- [ ] **Step 2: Create `src/lib/components/soundkeep/asset-icon.svelte`**

```svelte
<script lang="ts">
  import {
    AudioLines,
    Bell,
    CloudLightning,
    DoorOpen,
    Flame,
    Music2,
    Skull,
    Sparkles,
    Swords,
    Waves,
    Wind,
    Zap
  } from '@lucide/svelte';
  import type { AssetIcon } from '$lib/asset-metadata';

  let { icon, class: className }: { icon: AssetIcon; class?: string } = $props();

  const glyphs = {
    'audio-lines': AudioLines,
    bell: Bell,
    'cloud-lightning': CloudLightning,
    'door-open': DoorOpen,
    flame: Flame,
    music: Music2,
    skull: Skull,
    sparkles: Sparkles,
    swords: Swords,
    waves: Waves,
    wind: Wind,
    zap: Zap
  } satisfies Record<AssetIcon, typeof AudioLines>;

  let Glyph = $derived(glyphs[icon] ?? AudioLines);
</script>

<Glyph class={className} />
```

- [ ] **Step 3: Verify**

Run: `npm run format && npm run lint && npm run check`
Expected: all succeed, 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/soundkeep
git commit -m "feat(ui): add stat row and asset icon primitives"
```

---

### Task 3: Playback position helper (TDD)

The console currently interpolates playback position inline with a `clock` / `observedPosition` / `observedAt` triple. Extracting the arithmetic into a pure function makes it unit-testable and lets the dock reuse it. Vitest runs in a `node` environment with no DOM, so this must be a plain `.ts` module with no runes — the 250 ms tick stays in the component.

**Files:**

- Create: `src/lib/playback-position.ts`
- Test: `src/lib/playback-position.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:

```ts
export interface PlaybackObservation {
  positionMilliseconds: number;
  observedAtMilliseconds: number;
}
export function interpolatePlaybackPosition(input: {
  observation: PlaybackObservation | null;
  playing: boolean;
  nowMilliseconds: number;
  durationMilliseconds: number;
  repeat: boolean;
}): number;
```

- [ ] **Step 1: Write the failing test**

Create `src/lib/playback-position.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { interpolatePlaybackPosition } from './playback-position';

const observation = { positionMilliseconds: 10_000, observedAtMilliseconds: 1_000 };

describe('interpolatePlaybackPosition', () => {
  it('reports zero without an observation', () => {
    expect(
      interpolatePlaybackPosition({
        observation: null,
        playing: true,
        nowMilliseconds: 5_000,
        durationMilliseconds: 60_000,
        repeat: false
      })
    ).toBe(0);
  });

  it('holds the observed position while paused', () => {
    expect(
      interpolatePlaybackPosition({
        observation,
        playing: false,
        nowMilliseconds: 9_000,
        durationMilliseconds: 60_000,
        repeat: false
      })
    ).toBe(10_000);
  });

  it('adds elapsed wall-clock time while playing', () => {
    expect(
      interpolatePlaybackPosition({
        observation,
        playing: true,
        nowMilliseconds: 3_500,
        durationMilliseconds: 60_000,
        repeat: false
      })
    ).toBe(12_500);
  });

  it('clamps to the duration when repeat is off', () => {
    expect(
      interpolatePlaybackPosition({
        observation,
        playing: true,
        nowMilliseconds: 100_000,
        durationMilliseconds: 60_000,
        repeat: false
      })
    ).toBe(60_000);
  });

  it('wraps within the duration when repeat is on', () => {
    expect(
      interpolatePlaybackPosition({
        observation,
        playing: true,
        nowMilliseconds: 61_000,
        durationMilliseconds: 60_000,
        repeat: true
      })
    ).toBe(10_000);
  });

  it('returns the raw position when the duration is unknown', () => {
    expect(
      interpolatePlaybackPosition({
        observation,
        playing: true,
        nowMilliseconds: 3_000,
        durationMilliseconds: 0,
        repeat: false
      })
    ).toBe(12_000);
  });

  it('never reports a negative position when the clock runs backwards', () => {
    expect(
      interpolatePlaybackPosition({
        observation: { positionMilliseconds: 0, observedAtMilliseconds: 10_000 },
        playing: true,
        nowMilliseconds: 1_000,
        durationMilliseconds: 60_000,
        repeat: false
      })
    ).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/playback-position.test.ts`
Expected: FAIL — cannot resolve `./playback-position`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/playback-position.ts`:

```ts
export interface PlaybackObservation {
  positionMilliseconds: number;
  observedAtMilliseconds: number;
}

/**
 * Estimates the current playback position between server polls. The server reports the
 * authoritative position; this advances it by wall-clock time while the line is playing.
 */
export function interpolatePlaybackPosition(input: {
  observation: PlaybackObservation | null;
  playing: boolean;
  nowMilliseconds: number;
  durationMilliseconds: number;
  repeat: boolean;
}): number {
  const { observation, playing, nowMilliseconds, durationMilliseconds, repeat } = input;
  if (!observation) return 0;
  const elapsed = playing ? Math.max(0, nowMilliseconds - observation.observedAtMilliseconds) : 0;
  const position = Math.max(0, observation.positionMilliseconds + elapsed);
  if (durationMilliseconds <= 0) return position;
  return repeat ? position % durationMilliseconds : Math.min(durationMilliseconds, position);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/playback-position.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Run the whole unit suite**

Run: `npm run format && npm run lint && npm run check && npm run test:run`
Expected: all succeed. No existing test file was modified.

- [ ] **Step 6: Commit**

```bash
git add src/lib/playback-position.ts src/lib/playback-position.test.ts
git commit -m "feat: extract playback position interpolation with tests"
```

---

### Task 4: Transport dock and shell

The dock is mounted in the layout so background playback stays reachable from every route. The console still renders its own player card at the end of this task — two transports will be visible. That is the expected intermediate state and Task 5 removes the console copy.

**Files:**

- Create: `src/lib/components/soundkeep/transport-dock.svelte`
- Modify: `src/routes/+layout.svelte`

**Interfaces:**

- Consumes: `interpolatePlaybackPosition` and `PlaybackObservation` from Task 3; `formatDuration` from `$lib/utils`; `useSoundkeep()` from `$lib/soundkeep-client.svelte`.
- Produces: `<TransportDock />` — no props, reads context. Owns the only screen-reader `Background music` heading in the app after Task 5.

- [ ] **Step 1: Create `src/lib/components/soundkeep/transport-dock.svelte`**

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import {
    CircleStop,
    Music2,
    Pause,
    Play,
    Repeat,
    Repeat1,
    Shuffle,
    SkipBack,
    SkipForward,
    Volume2
  } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Slider } from '$lib/components/ui/slider';
  import { Spinner } from '$lib/components/ui/spinner';
  import { interpolatePlaybackPosition, type PlaybackObservation } from '$lib/playback-position';
  import { useSoundkeep } from '$lib/soundkeep-client.svelte';
  import { cn, formatDuration } from '$lib/utils';

  const soundkeep = useSoundkeep();

  let clock = $state(Date.now());
  let observation = $state<PlaybackObservation | null>(null);
  let masterPercent = $state(Math.round(soundkeep.state.masterVolume * 100));

  let source = $derived(soundkeep.backgroundSource);
  let currentAsset = $derived(
    soundkeep.state.assets.find((asset) => asset.id === source?.assetId) ?? null
  );
  let durationMilliseconds = $derived(
    Math.max(0, Math.round((source?.duration ?? currentAsset?.duration ?? 0) * 1_000))
  );
  let position = $derived(
    interpolatePlaybackPosition({
      observation,
      playing: source?.state === 'playing',
      nowMilliseconds: clock,
      durationMilliseconds,
      repeat: source?.repeat ?? false
    })
  );
  let repeatMode = $derived(soundkeep.state.playback.repeatMode);
  let repeatLabel = $derived(
    repeatMode === 'one' ? 'Repeat one' : repeatMode === 'all' ? 'Repeat all' : 'Repeat off'
  );
  let transportBusy = $derived(
    soundkeep.busy?.startsWith('transport-') || soundkeep.busy?.startsWith('play-ambience')
  );

  onMount(() => {
    const interval = window.setInterval(() => {
      clock = Date.now();
    }, 250);
    return () => window.clearInterval(interval);
  });

  $effect(() => {
    const current = soundkeep.backgroundSource;
    if (!current) {
      observation = null;
      return;
    }
    current.id;
    current.state;
    observation = {
      positionMilliseconds: current.positionMilliseconds,
      observedAtMilliseconds: Date.now()
    };
  });

  $effect(() => {
    masterPercent = Math.round(soundkeep.state.masterVolume * 100);
  });

  function cycleRepeat() {
    const next = repeatMode === 'off' ? 'all' : repeatMode === 'all' ? 'one' : 'off';
    return soundkeep.configurePlayback({ repeatMode: next });
  }

  async function seek(event: Event) {
    if (!source) return;
    const positionMilliseconds = Number((event.currentTarget as HTMLInputElement).value);
    observation = { positionMilliseconds, observedAtMilliseconds: Date.now() };
    await soundkeep.changeSourceTransport(source.id, { positionMilliseconds });
  }

  async function changeMasterVolume(event: Event) {
    masterPercent = Number((event.currentTarget as HTMLInputElement).value);
    await soundkeep.changeMasterVolume(masterPercent / 100);
  }

  function togglePlayback() {
    if (!source) return;
    return soundkeep.changeSourceTransport(source.id, { paused: source.state !== 'paused' });
  }
</script>

<section
  data-slot="transport-dock"
  class="bg-background/95 sticky bottom-0 z-20 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-t px-3 py-2 backdrop-blur md:px-4"
  aria-label="Background transport"
>
  <h2 class="sr-only">Background music</h2>

  <div class="flex min-w-56 flex-1 items-center gap-2.5">
    <span
      class="bg-muted grid size-10 shrink-0 place-items-center overflow-hidden rounded-md border"
    >
      {#if currentAsset?.artworkFilename}
        <img
          src={`/api/library/${currentAsset.id}/artwork?v=${encodeURIComponent(currentAsset.updatedAt)}`}
          alt=""
          class="size-full object-cover"
        />
      {:else}
        <Music2 class="text-muted-foreground size-4" />
      {/if}
    </span>
    <span class="min-w-0">
      <span class="block truncate text-sm font-semibold">
        {source?.label ?? 'Nothing playing'}
      </span>
      <span class="metric-label block truncate">
        {currentAsset?.subtitle ||
          currentAsset?.mood ||
          currentAsset?.category ||
          (source ? 'Streaming to Discord' : 'Pick a track from the queue')}
      </span>
    </span>
    {#if source?.state === 'playing'}
      <span class="ml-auto flex h-4 items-end gap-0.5 pr-1" aria-hidden="true">
        <span class="meter-bar bg-primary h-2 w-0.5 rounded-full"></span>
        <span class="meter-bar bg-primary h-3.5 w-0.5 rounded-full"></span>
        <span class="meter-bar bg-primary h-2.5 w-0.5 rounded-full"></span>
      </span>
    {/if}
  </div>

  <div class="flex min-w-72 flex-2 items-center gap-2">
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Toggle shuffle"
      class={soundkeep.state.playback.shuffle ? 'text-primary' : undefined}
      onclick={() => soundkeep.configurePlayback({ shuffle: !soundkeep.state.playback.shuffle })}
    >
      <Shuffle />
    </Button>
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Previous background track"
      disabled={soundkeep.visibleBackgroundAssets.length === 0}
      onclick={() => soundkeep.previousTrack()}
    >
      <SkipBack />
    </Button>
    <Button
      size="icon"
      aria-label={source?.state === 'paused' ? 'Resume background' : 'Pause background'}
      disabled={!source || !soundkeep.state.discord.connected}
      onclick={togglePlayback}
    >
      {#if transportBusy}
        <Spinner />
      {:else if source && source.state !== 'paused'}
        <Pause />
      {:else}
        <Play />
      {/if}
    </Button>
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Next background track"
      disabled={soundkeep.visibleBackgroundAssets.length === 0}
      onclick={() => soundkeep.nextTrack()}
    >
      <SkipForward />
    </Button>
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={repeatLabel}
      class={repeatMode !== 'off' ? 'text-primary' : undefined}
      onclick={cycleRepeat}
    >
      {#if repeatMode === 'one'}<Repeat1 />{:else}<Repeat />{/if}
    </Button>

    <span class="metric-label w-10 shrink-0 text-right tabular-nums">
      {formatDuration(position / 1_000)}
    </span>
    <Slider
      value={Math.round(position)}
      min={0}
      max={Math.max(durationMilliseconds, 1)}
      step={250}
      disabled={!source || durationMilliseconds === 0}
      aria-label="Background playback position"
      onchange={seek}
    />
    <span class="metric-label w-10 shrink-0 tabular-nums">
      {formatDuration(durationMilliseconds / 1_000)}
    </span>

    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Stop background"
      disabled={!source}
      onclick={() => soundkeep.stopScope('ambience')}
    >
      <CircleStop />
    </Button>
  </div>

  <div class="flex min-w-64 flex-1 items-center justify-end gap-4">
    {#if source}
      <div class="flex w-32 items-center gap-1.5">
        <span class="metric-label shrink-0">Line</span>
        <Slider
          value={Math.round(source.volume * 100)}
          aria-label={`Volume for ${source.label}`}
          onchange={(event) =>
            soundkeep.changeSourceVolume(
              source!.id,
              Number((event.currentTarget as HTMLInputElement).value) / 100
            )}
        />
      </div>
    {/if}
    <div class="flex w-40 items-center gap-1.5">
      <Volume2 class="text-primary size-4 shrink-0" />
      <Slider bind:value={masterPercent} aria-label="Master volume" onchange={changeMasterVolume} />
      <span class={cn('metric-label w-7 shrink-0 text-right tabular-nums')}>{masterPercent}</span>
    </div>
  </div>
</section>
```

- [ ] **Step 2: Mount the dock and compact the header in `src/routes/+layout.svelte`**

Make exactly these edits:

1. In the import list, remove `Volume2` from the `@lucide/svelte` import and remove the `Slider` import line. Add `import TransportDock from '$lib/components/soundkeep/transport-dock.svelte';` after the `provideSoundkeep` import.
2. Delete the `masterPercent` state declaration, the `$effect` that syncs it, and the `changeMasterVolume` function.
3. Change the header element's classes from `'bg-background/90 flex h-16 shrink-0 items-center gap-3 border-b px-4 backdrop-blur md:px-6'` to `'bg-background/90 flex h-12 shrink-0 items-center gap-2 border-b px-3 backdrop-blur md:px-4'`.
4. Delete the whole `<div class="bg-muted/50 hidden w-52 items-center gap-2 rounded-full border px-3 py-1.5 2xl:flex"> … </div>` block containing the master volume slider.
5. Delete the entire `<Sidebar.Group class="mt-auto">` block holding the `Session` label with the Background and Soundboard badges — the dock now reports line state.
6. Add `data-app-shell` and the title bar spacer to `Sidebar.Inset`: change `<Sidebar.Inset class="min-h-0 overflow-hidden">` to:

```svelte
  <Sidebar.Inset data-app-shell class="min-h-0 pt-(--titlebar-height)">
```

7. Change the routed-content wrapper so pages scroll normally on every route. Replace this block:

```svelte
    <div
      class={cn(
        'flex min-h-0 flex-1 flex-col',
        pathname === '/' ? 'overflow-hidden' : 'overflow-y-auto'
      )}
    >
```

with:

```svelte
    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
```

8. Immediately after the closing `</div>` of that wrapper and before `</Sidebar.Inset>`, add:

```svelte
<TransportDock />
```

9. The `cn` import is now unused if no other call site remains — check with `npm run check` and remove the import only if it reports it unused.

- [ ] **Step 3: Verify**

Run: `npm run format && npm run lint && npm run check && npm run build`
Expected: all succeed. Two transports temporarily visible in the console — expected until Task 5.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/soundkeep/transport-dock.svelte src/routes/+layout.svelte
git commit -m "feat(ui): add persistent transport dock to the app shell"
```

---

### Task 5: Console rewrite

**Files:**

- Create: `src/lib/components/soundkeep/scene-list.svelte`
- Create: `src/lib/components/soundkeep/scene-editor-dialog.svelte`
- Create: `src/lib/components/soundkeep/scene-delete-dialog.svelte`
- Create: `src/lib/components/soundkeep/queue-list.svelte`
- Create: `src/lib/components/soundkeep/soundboard-grid.svelte`
- Create: `src/lib/components/soundkeep/output-panel.svelte`
- Create: `src/lib/components/soundkeep/activity-feed.svelte`
- Modify: `src/routes/+page.svelte` (full rewrite)

**Interfaces:**

- Consumes: `StatRow` and `AssetIconGlyph` from Task 2; `useSoundkeep()`; `formatDuration` from `$lib/utils`.
- Produces:
  - `SceneList` props: `{ onedit: (scene: SceneCollection) => void; ondelete: (scene: SceneCollection) => void; oncreate: () => void }`
  - `SceneEditorDialog` props: `{ open: boolean (bindable); scene: SceneCollection | null }` — `null` means create.
  - `SceneDeleteDialog` props: `{ scene: SceneCollection | null; onclose: () => void }`
  - `QueueList`, `SoundboardGrid`, `OutputPanel`, `ActivityFeed`: no props.

- [ ] **Step 1: Create `src/lib/components/soundkeep/scene-list.svelte`**

```svelte
<script lang="ts">
  import { AudioLines, Layers3, Pencil, Plus, Trash2 } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import { useSoundkeep } from '$lib/soundkeep-client.svelte';
  import type { SceneCollection } from '$lib/types';
  import { cn } from '$lib/utils';

  let {
    onedit,
    ondelete,
    oncreate
  }: {
    onedit: (scene: SceneCollection) => void;
    ondelete: (scene: SceneCollection) => void;
    oncreate: () => void;
  } = $props();

  const soundkeep = useSoundkeep();
  const rowClass =
    'hover:bg-muted flex w-full min-h-(--row-h) items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors';
</script>

<Card.Root class="flex min-w-0 flex-col">
  <Card.Header class="flex-row items-center justify-between gap-2 pb-2">
    <Card.Title class="flex items-center gap-2 text-sm tracking-wide uppercase">
      <Layers3 class="size-4" />
      Scenes
    </Card.Title>
    <Button size="icon-xs" variant="ghost" aria-label="Create scene" onclick={oncreate}>
      <Plus />
    </Button>
  </Card.Header>
  <Card.Content class="flex flex-col gap-0.5 pb-3">
    <button
      type="button"
      class={cn(
        rowClass,
        soundkeep.state.playback.activeSceneId === null && 'bg-primary/10 text-primary'
      )}
      aria-pressed={soundkeep.state.playback.activeSceneId === null}
      onclick={() => soundkeep.setActiveScene(null)}
    >
      <AudioLines class="size-4 shrink-0" />
      <span class="min-w-0 flex-1 truncate font-medium">All sounds</span>
      <span class="metric-label shrink-0">{soundkeep.state.assets.length}</span>
    </button>
    {#each soundkeep.state.scenes as scene (scene.id)}
      {@const active = scene.id === soundkeep.state.playback.activeSceneId}
      <div class="flex items-center gap-0.5">
        <button
          type="button"
          class={cn(rowClass, 'min-w-0 flex-1', active && 'bg-primary/10 text-primary')}
          aria-pressed={active}
          onclick={() => soundkeep.setActiveScene(scene.id)}
        >
          <Layers3 class="size-4 shrink-0" />
          <span class="min-w-0 flex-1 truncate font-medium">{scene.name}</span>
          <span class="metric-label shrink-0">
            {scene.trackIds.length + scene.effectIds.length}
          </span>
        </button>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={`Edit ${scene.name}`}
          onclick={() => onedit(scene)}
        >
          <Pencil />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          class="text-destructive"
          aria-label={`Delete ${scene.name}`}
          onclick={() => ondelete(scene)}
        >
          <Trash2 />
        </Button>
      </div>
    {:else}
      <p class="metric-label rounded-md border border-dashed p-3 text-center">
        No scenes yet. Create one to group tracks and effects.
      </p>
    {/each}
  </Card.Content>
</Card.Root>
```

- [ ] **Step 2: Create `src/lib/components/soundkeep/scene-editor-dialog.svelte`**

```svelte
<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Field from '$lib/components/ui/field';
  import { Input } from '$lib/components/ui/input';
  import * as ScrollArea from '$lib/components/ui/scroll-area';
  import { Spinner } from '$lib/components/ui/spinner';
  import { Textarea } from '$lib/components/ui/textarea';
  import { useSoundkeep } from '$lib/soundkeep-client.svelte';
  import type { SceneCollection } from '$lib/types';

  let { open = $bindable(false), scene }: { open?: boolean; scene: SceneCollection | null } =
    $props();

  const soundkeep = useSoundkeep();

  let name = $state('');
  let description = $state('');
  let trackIds = $state<string[]>([]);
  let effectIds = $state<string[]>([]);

  $effect(() => {
    if (!open) return;
    name = scene?.name ?? '';
    description = scene?.description ?? '';
    trackIds = [...(scene?.trackIds ?? [])];
    effectIds = [...(scene?.effectIds ?? [])];
  });

  function assign(kind: 'track' | 'effect', id: string, checked: boolean) {
    const current = kind === 'track' ? trackIds : effectIds;
    const next = checked
      ? current.includes(id)
        ? current
        : [...current, id]
      : current.filter((candidate) => candidate !== id);
    if (kind === 'track') trackIds = next;
    else effectIds = next;
  }

  async function save() {
    const input = { name, description, trackIds, effectIds };
    const saved = scene
      ? await soundkeep.updateScene(scene, input)
      : await soundkeep.createScene(input);
    if (saved) open = false;
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-3xl">
    <Dialog.Header>
      <Dialog.Title>{scene ? 'Edit scene' : 'Create scene'}</Dialog.Title>
      <Dialog.Description>
        Bundle background tracks and sound effects into a reusable tabletop preset.
      </Dialog.Description>
    </Dialog.Header>

    <Field.Group>
      <div class="grid gap-3 sm:grid-cols-2">
        <Field.Field>
          <Field.Label for="scene-name">Name</Field.Label>
          <Input id="scene-name" bind:value={name} maxlength={100} placeholder="Haunted crypt" />
        </Field.Field>
        <Field.Field>
          <Field.Label for="scene-description">Description</Field.Label>
          <Textarea
            id="scene-description"
            bind:value={description}
            maxlength={500}
            rows={2}
            placeholder="The party descends below the chapel…"
          />
        </Field.Field>
      </div>

      <div class="grid min-h-0 gap-3 sm:grid-cols-2">
        <Field.Set>
          <Field.Legend variant="label">Background tracks</Field.Legend>
          <Field.Description>{trackIds.length} selected</Field.Description>
          <ScrollArea.Root class="mt-2 h-52 rounded-md border">
            <Field.Group class="gap-0.5 p-2">
              {#each soundkeep.backgroundAssets as asset (asset.id)}
                <Field.Label class="hover:bg-muted rounded-md">
                  <Field.Field orientation="horizontal">
                    <Checkbox
                      checked={trackIds.includes(asset.id)}
                      onCheckedChange={(checked: boolean) => assign('track', asset.id, checked)}
                    />
                    <Field.Content>
                      <Field.Title>{asset.name}</Field.Title>
                      <Field.Description>{asset.category}</Field.Description>
                    </Field.Content>
                  </Field.Field>
                </Field.Label>
              {:else}
                <p class="metric-label p-3 text-center">No background MP3s.</p>
              {/each}
            </Field.Group>
          </ScrollArea.Root>
        </Field.Set>

        <Field.Set>
          <Field.Legend variant="label">Sound effects</Field.Legend>
          <Field.Description>{effectIds.length} selected</Field.Description>
          <ScrollArea.Root class="mt-2 h-52 rounded-md border">
            <Field.Group class="gap-0.5 p-2">
              {#each soundkeep.soundboardAssets as asset (asset.id)}
                <Field.Label class="hover:bg-muted rounded-md">
                  <Field.Field orientation="horizontal">
                    <Checkbox
                      checked={effectIds.includes(asset.id)}
                      onCheckedChange={(checked: boolean) => assign('effect', asset.id, checked)}
                    />
                    <Field.Content>
                      <Field.Title>{asset.name}</Field.Title>
                      <Field.Description>{asset.category}</Field.Description>
                    </Field.Content>
                  </Field.Field>
                </Field.Label>
              {:else}
                <p class="metric-label p-3 text-center">No soundboard MP3s.</p>
              {/each}
            </Field.Group>
          </ScrollArea.Root>
        </Field.Set>
      </div>
    </Field.Group>

    <Dialog.Footer>
      <Dialog.Close>
        {#snippet child({ props })}
          <Button variant="outline" {...props}>Cancel</Button>
        {/snippet}
      </Dialog.Close>
      <Button
        disabled={!name.trim() ||
          trackIds.length + effectIds.length === 0 ||
          soundkeep.busy !== null}
        onclick={save}
      >
        {#if soundkeep.busy === 'create-scene' || soundkeep.busy?.startsWith('edit-scene-')}
          <Spinner data-icon="inline-start" />
        {/if}
        {scene ? 'Save scene' : 'Create scene'}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
```

- [ ] **Step 3: Create `src/lib/components/soundkeep/scene-delete-dialog.svelte`**

```svelte
<script lang="ts">
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import { useSoundkeep } from '$lib/soundkeep-client.svelte';
  import type { SceneCollection } from '$lib/types';

  let { scene, onclose }: { scene: SceneCollection | null; onclose: () => void } = $props();

  const soundkeep = useSoundkeep();

  async function confirm() {
    if (!scene) return;
    const deleted = await soundkeep.deleteScene(scene);
    if (deleted) onclose();
  }
</script>

<AlertDialog.Root open={scene !== null} onOpenChange={(open) => !open && onclose()}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Delete {scene?.name}?</AlertDialog.Title>
      <AlertDialog.Description>
        The scene preset will be removed. Its MP3 files stay in the Library.
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action variant="destructive" onclick={confirm}>Delete scene</AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
```

- [ ] **Step 4: Create `src/lib/components/soundkeep/queue-list.svelte`**

The `Library selection` select and its play button live here. That accessible name is part of the end-to-end contract.

```svelte
<script lang="ts">
  import { ListMusic, Music2, Play } from '@lucide/svelte';
  import * as Avatar from '$lib/components/ui/avatar';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import * as ScrollArea from '$lib/components/ui/scroll-area';
  import * as Select from '$lib/components/ui/select';
  import { useSoundkeep } from '$lib/soundkeep-client.svelte';
  import type { AudioAsset } from '$lib/types';
  import { cn, formatDuration } from '$lib/utils';

  const soundkeep = useSoundkeep();

  let selected = $state('');

  $effect(() => {
    const candidates = soundkeep.visibleBackgroundAssets;
    if (!selected || !candidates.some((asset) => asset.id === selected)) {
      selected =
        candidates.find((asset) => asset.id === soundkeep.backgroundSource?.assetId)?.id ??
        candidates[0]?.id ??
        '';
    }
  });

  async function playSelected() {
    const asset = soundkeep.state.assets.find((item) => item.id === selected);
    if (asset) await soundkeep.playAsset(asset, 'ambience');
  }

  async function play(asset: AudioAsset) {
    selected = asset.id;
    await soundkeep.playAsset(asset, 'ambience');
  }
</script>

<Card.Root class="flex min-w-0 flex-col">
  <Card.Header class="flex-row items-center justify-between gap-2 pb-2">
    <Card.Title class="flex items-center gap-2 text-sm tracking-wide uppercase">
      <ListMusic class="size-4" />
      Queue
    </Card.Title>
    <Badge variant="outline">{soundkeep.visibleBackgroundAssets.length}</Badge>
  </Card.Header>
  <Card.Content class="flex min-w-0 flex-col gap-2 pb-3">
    <div class="flex min-w-0 gap-1.5">
      <Select.Root type="single" bind:value={selected}>
        <Select.Trigger
          id="background-select"
          class="h-8 min-w-0 flex-1"
          aria-label="Library selection"
        >
          <span class="truncate">
            {soundkeep.state.assets.find((asset) => asset.id === selected)?.name ??
              'Choose a track'}
          </span>
        </Select.Trigger>
        <Select.Content>
          <Select.Group>
            <Select.Label>{soundkeep.activeScene?.name ?? 'Background library'}</Select.Label>
            {#each soundkeep.visibleBackgroundAssets as asset (asset.id)}
              <Select.Item value={asset.id}>{asset.name}</Select.Item>
            {/each}
          </Select.Group>
        </Select.Content>
      </Select.Root>
      <Button
        size="icon-sm"
        variant="outline"
        aria-label="Play selected background"
        disabled={!selected || !soundkeep.state.discord.connected}
        onclick={playSelected}
      >
        <Play />
      </Button>
    </div>

    {#if soundkeep.visibleBackgroundAssets.length === 0}
      <p class="metric-label rounded-md border border-dashed p-3 text-center">
        No background tracks in this scene.
      </p>
    {:else}
      <ScrollArea.Root class="h-64">
        <div class="flex flex-col gap-0.5 pr-2">
          {#each soundkeep.visibleBackgroundAssets as asset (asset.id)}
            {@const active = soundkeep.backgroundSource?.assetId === asset.id}
            <button
              type="button"
              class={cn(
                'hover:bg-muted flex min-h-(--row-h) w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors disabled:opacity-45',
                active && 'bg-primary/10'
              )}
              aria-label={`Play background ${asset.name}`}
              aria-current={active ? 'true' : undefined}
              disabled={!soundkeep.state.discord.connected}
              onclick={() => play(asset)}
            >
              <Avatar.Root class="size-7 shrink-0 rounded-sm after:rounded-sm">
                {#if asset.artworkFilename}
                  <Avatar.Image
                    src={`/api/library/${asset.id}/artwork?v=${encodeURIComponent(asset.updatedAt)}`}
                    alt=""
                    class="rounded-sm"
                  />
                {/if}
                <Avatar.Fallback class="rounded-sm">
                  <Music2 class="size-3.5" />
                </Avatar.Fallback>
              </Avatar.Root>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-xs font-medium">{asset.name}</span>
                <span class="metric-label block truncate">
                  {asset.subtitle || asset.category}
                </span>
              </span>
              <span class="metric-label shrink-0 tabular-nums">
                {formatDuration(asset.duration)}
              </span>
            </button>
          {/each}
        </div>
      </ScrollArea.Root>
    {/if}
  </Card.Content>
</Card.Root>
```

- [ ] **Step 5: Create `src/lib/components/soundkeep/soundboard-grid.svelte`**

The `Soundboard` heading inside a `[data-slot="card"]` is part of the end-to-end contract, as is each button's accessible name `Play <asset name>`.

```svelte
<script lang="ts">
  import { CircleStop, FolderOpen, WandSparkles } from '@lucide/svelte';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import * as Empty from '$lib/components/ui/empty';
  import { Spinner } from '$lib/components/ui/spinner';
  import * as Tabs from '$lib/components/ui/tabs';
  import AssetIconGlyph from '$lib/components/soundkeep/asset-icon.svelte';
  import { useSoundkeep } from '$lib/soundkeep-client.svelte';
  import { cn } from '$lib/utils';

  const soundkeep = useSoundkeep();

  let selectedCategory = $state('all');

  let categories = $derived(
    [...new Set(soundkeep.visibleSoundboardAssets.map((asset) => asset.category))].sort(
      (left, right) => left.localeCompare(right)
    )
  );
  let visible = $derived(
    selectedCategory === 'all'
      ? soundkeep.visibleSoundboardAssets
      : soundkeep.visibleSoundboardAssets.filter((asset) => asset.category === selectedCategory)
  );

  $effect(() => {
    if (selectedCategory !== 'all' && !categories.includes(selectedCategory)) {
      selectedCategory = 'all';
    }
  });
</script>

<Card.Root class="flex min-w-0 flex-col">
  <Card.Header class="flex-row items-start justify-between gap-3 pb-2">
    <div class="min-w-0">
      <Card.Title class="flex items-center gap-2 text-base">
        <WandSparkles class="size-4" />
        Soundboard
      </Card.Title>
      <Card.Description class="text-micro">
        One-shot effects play over the background line without interrupting it.
      </Card.Description>
    </div>
    <div class="flex shrink-0 items-center gap-1.5">
      {#if soundkeep.soundboardSource}
        <Badge variant="secondary">Playing</Badge>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Stop soundboard"
          onclick={() => soundkeep.stopScope('soundboard')}
        >
          <CircleStop />
        </Button>
      {:else}
        <Badge variant="outline">Line 2</Badge>
      {/if}
    </div>
  </Card.Header>

  <Card.Content class="flex min-w-0 flex-1 flex-col">
    {#if soundkeep.visibleSoundboardAssets.length === 0}
      <Empty.Root class="flex-1">
        <Empty.Header>
          <Empty.Media variant="icon"><WandSparkles /></Empty.Media>
          <Empty.Title>No effects in this scene</Empty.Title>
          <Empty.Description>
            Add soundboard MP3s in the Library or edit the active scene.
          </Empty.Description>
        </Empty.Header>
        <Empty.Content>
          <Button href="/library" variant="outline" size="sm">
            <FolderOpen data-icon="inline-start" />
            Open library
          </Button>
        </Empty.Content>
      </Empty.Root>
    {:else}
      <Tabs.Root bind:value={selectedCategory} class="min-w-0 flex-1">
        <div class="w-full min-w-0 overflow-x-auto pb-1">
          <Tabs.List variant="line">
            <Tabs.Trigger value="all">
              All sounds
              <Badge variant="outline">{soundkeep.visibleSoundboardAssets.length}</Badge>
            </Tabs.Trigger>
            {#each categories as category (category)}
              <Tabs.Trigger value={category}>
                {category}
                <Badge variant="outline">
                  {soundkeep.visibleSoundboardAssets.filter((asset) => asset.category === category)
                    .length}
                </Badge>
              </Tabs.Trigger>
            {/each}
          </Tabs.List>
        </div>

        {#key selectedCategory}
          <Tabs.Content value={selectedCategory} class="min-w-0 pt-2.5">
            <div
              class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"
            >
              {#each visible as asset (asset.id)}
                {@const active = soundkeep.soundboardSource?.assetId === asset.id}
                <button
                  type="button"
                  aria-label={`Play ${asset.name}`}
                  aria-pressed={active}
                  class={cn(
                    'group focus-visible:ring-ring/50 hover:bg-muted relative flex aspect-square min-h-20 flex-col items-center justify-center gap-1.5 rounded-lg border p-2 text-center transition-all outline-none hover:-translate-y-0.5 focus-visible:ring-3 active:translate-y-0 disabled:pointer-events-none disabled:opacity-45',
                    active
                      ? 'border-primary/60 bg-primary/10 shadow-[0_16px_36px_-26px_var(--primary)]'
                      : 'border-border/80 bg-secondary/30 hover:border-primary/35'
                  )}
                  disabled={!soundkeep.state.discord.connected || soundkeep.busy !== null}
                  onclick={() => soundkeep.playAsset(asset, 'soundboard')}
                >
                  <span
                    class={cn(
                      'grid size-8 place-items-center rounded-md transition-transform group-hover:scale-105',
                      active ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
                    )}
                  >
                    {#if soundkeep.busy === `play-soundboard-${asset.id}`}
                      <Spinner />
                    {:else}
                      <AssetIconGlyph icon={asset.icon} class="size-4" />
                    {/if}
                  </span>
                  <span class="line-clamp-2 text-xs leading-tight font-semibold">
                    {asset.name}
                  </span>
                  <span class="metric-label max-w-full truncate">
                    {asset.subtitle || asset.mood || asset.category}
                  </span>
                  {#if active}
                    <span
                      class="ring-primary/45 pointer-events-none absolute inset-0 rounded-lg ring-2"
                      aria-hidden="true"
                    ></span>
                  {/if}
                </button>
              {/each}
            </div>
          </Tabs.Content>
        {/key}
      </Tabs.Root>
    {/if}
  </Card.Content>
</Card.Root>
```

- [ ] **Step 6: Create `src/lib/components/soundkeep/output-panel.svelte`**

```svelte
<script lang="ts">
  import { CircleStop, Gauge, Radio } from '@lucide/svelte';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import StatRow from '$lib/components/soundkeep/stat-row.svelte';
  import { useSoundkeep } from '$lib/soundkeep-client.svelte';

  const soundkeep = useSoundkeep();

  let bitrateLabel = $derived.by(() => {
    const diagnostics = soundkeep.state.discord.audioDiagnostics;
    if (diagnostics.bitrate !== null) return `${Math.round(diagnostics.bitrate / 1_000)} kbps`;
    if (diagnostics.bitrateMode === 'auto') return 'Auto';
    return `${Math.round(Number(diagnostics.bitrateMode) / 1_000)} kbps target`;
  });
</script>

<Card.Root class="min-w-0">
  <Card.Header class="flex-row items-center justify-between gap-2 pb-2">
    <Card.Title class="flex items-center gap-2 text-sm tracking-wide uppercase">
      <Gauge class="size-4" />
      Output
    </Card.Title>
    <Badge variant={soundkeep.state.discord.connected ? 'success' : 'outline'}>
      <Radio />
      {soundkeep.state.discord.connected ? 'Live' : 'Offline'}
    </Badge>
  </Card.Header>
  <Card.Content class="flex flex-col gap-2 pb-3">
    <div>
      <StatRow label="Channel" value={soundkeep.state.discord.channelName ?? 'Not connected'} />
      <StatRow label="Listeners" value={soundkeep.state.discord.listenerCount} />
      <StatRow label="Bitrate" value={bitrateLabel} />
      <StatRow label="Player" value={soundkeep.state.discord.playerState} />
    </div>
    <Button
      variant="destructive"
      size="sm"
      disabled={!soundkeep.backgroundSource && !soundkeep.soundboardSource}
      onclick={() => soundkeep.stopScope('all')}
    >
      <CircleStop data-icon="inline-start" />
      Stop all audio
    </Button>
  </Card.Content>
</Card.Root>
```

- [ ] **Step 7: Create `src/lib/components/soundkeep/activity-feed.svelte`**

```svelte
<script lang="ts">
  import { Activity, AudioLines, Layers3, ListMusic, Radio } from '@lucide/svelte';
  import * as Card from '$lib/components/ui/card';
  import * as ScrollArea from '$lib/components/ui/scroll-area';
  import { useSoundkeep } from '$lib/soundkeep-client.svelte';

  const soundkeep = useSoundkeep();

  function time(timestamp: string) {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(timestamp));
  }
</script>

<Card.Root class="flex min-w-0 flex-col">
  <Card.Header class="pb-2">
    <Card.Title class="flex items-center gap-2 text-sm tracking-wide uppercase">
      <Activity class="size-4" />
      Activity
    </Card.Title>
  </Card.Header>
  <Card.Content class="pb-3">
    {#if soundkeep.state.activity.length === 0}
      <p class="metric-label py-3 text-center">No session activity yet.</p>
    {:else}
      <ScrollArea.Root class="h-56">
        <div class="flex flex-col pr-2">
          {#each soundkeep.state.activity as entry (entry.id)}
            <div class="border-border/40 flex items-start gap-2 border-b py-1.5 last:border-b-0">
              <span class="text-muted-foreground mt-0.5 shrink-0">
                {#if entry.category === 'discord'}
                  <Radio class="size-3" />
                {:else if entry.category === 'scene'}
                  <Layers3 class="size-3" />
                {:else if entry.category === 'library'}
                  <ListMusic class="size-3" />
                {:else}
                  <AudioLines class="size-3" />
                {/if}
              </span>
              <span class="text-micro min-w-0 flex-1 leading-snug">{entry.message}</span>
              <span class="metric-label shrink-0 tabular-nums">{time(entry.createdAt)}</span>
            </div>
          {/each}
        </div>
      </ScrollArea.Root>
    {/if}
  </Card.Content>
</Card.Root>
```

- [ ] **Step 8: Rewrite `src/routes/+page.svelte`**

Replace the entire file with:

```svelte
<script lang="ts">
  import { Layers3, Plus } from '@lucide/svelte';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import ActivityFeed from '$lib/components/soundkeep/activity-feed.svelte';
  import OutputPanel from '$lib/components/soundkeep/output-panel.svelte';
  import QueueList from '$lib/components/soundkeep/queue-list.svelte';
  import SceneDeleteDialog from '$lib/components/soundkeep/scene-delete-dialog.svelte';
  import SceneEditorDialog from '$lib/components/soundkeep/scene-editor-dialog.svelte';
  import SceneList from '$lib/components/soundkeep/scene-list.svelte';
  import SoundboardGrid from '$lib/components/soundkeep/soundboard-grid.svelte';
  import { useSoundkeep } from '$lib/soundkeep-client.svelte';
  import type { SceneCollection } from '$lib/types';

  const soundkeep = useSoundkeep();

  let editorOpen = $state(false);
  let editingScene = $state<SceneCollection | null>(null);
  let deletingScene = $state<SceneCollection | null>(null);

  function openEditor(scene: SceneCollection | null) {
    editingScene = scene;
    editorOpen = true;
  }
</script>

<div class="flex min-w-0 flex-1 flex-col">
  <div
    class="bg-card/35 flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-2 md:px-4"
  >
    <div class="min-w-0">
      <h1 class="font-display text-base font-semibold tracking-tight">Session console</h1>
      <p class="metric-label truncate">
        Scenes, effects, transport, and Discord output in one live control surface.
      </p>
    </div>
    <div class="flex flex-wrap items-center gap-1.5">
      <Badge variant="outline">
        <Layers3 />
        {soundkeep.activeScene?.name ?? 'All sounds'}
      </Badge>
      <Badge variant="outline">{soundkeep.visibleBackgroundAssets.length} tracks</Badge>
      <Badge variant="outline">{soundkeep.visibleSoundboardAssets.length} effects</Badge>
      <Button href="/library" variant="outline" size="sm">
        <Plus data-icon="inline-start" />
        Add MP3
      </Button>
    </div>
  </div>

  <div
    class="grid min-w-0 flex-1 grid-cols-1 items-start gap-3 p-3 md:p-4 xl:grid-cols-[14rem_minmax(0,1fr)_17rem]"
  >
    <div class="flex min-w-0 flex-col gap-3">
      <SceneList
        oncreate={() => openEditor(null)}
        onedit={(scene) => openEditor(scene)}
        ondelete={(scene) => (deletingScene = scene)}
      />
      <QueueList />
    </div>

    <SoundboardGrid />

    <div class="flex min-w-0 flex-col gap-3">
      <OutputPanel />
      <ActivityFeed />
    </div>
  </div>
</div>

<SceneEditorDialog bind:open={editorOpen} scene={editingScene} />
<SceneDeleteDialog scene={deletingScene} onclose={() => (deletingScene = null)} />
```

- [ ] **Step 9: Verify the console**

Run: `npm run format && npm run lint && npm run check && npm run build && npm run test:run`
Expected: all succeed. Only one transport is now visible, in the dock.

- [ ] **Step 10: Commit**

```bash
git add src/lib/components/soundkeep src/routes/+page.svelte
git commit -m "feat(ui): rebuild the session console as a dense three-column dashboard"
```

---

### Task 6: Library rewrite

The upload form stays inline on the page — `#audio-upload`, `#upload-name` and `#upload-category` must be directly fillable, and the page must contain no `role="tab"` elements.

**Files:**

- Create: `src/lib/components/soundkeep/asset-upload-panel.svelte`
- Create: `src/lib/components/soundkeep/asset-table.svelte`
- Create: `src/lib/components/soundkeep/asset-edit-dialog.svelte`
- Create: `src/lib/components/soundkeep/asset-delete-dialog.svelte`
- Create: `src/lib/components/soundkeep/storage-panel.svelte`
- Modify: `src/routes/library/+page.svelte` (full rewrite)

**Interfaces:**

- Consumes: `StatRow`, `AssetIconGlyph`; `useSoundkeep()`; `formatBytes` and `formatDuration` from `$lib/utils`; `ASSET_ICONS` and `AssetIcon` from `$lib/asset-metadata`.
- Produces:
  - `AssetUploadPanel`: no props.
  - `AssetTable` props: `{ onedit: (asset: AudioAsset) => void; ondelete: (asset: AudioAsset) => void }`
  - `AssetEditDialog` props: `{ open: boolean (bindable); asset: AudioAsset | null }`
  - `AssetDeleteDialog` props: `{ asset: AudioAsset | null; onclose: () => void }`
  - `StoragePanel`: no props.

- [ ] **Step 1: Create `src/lib/components/soundkeep/asset-upload-panel.svelte`**

This is a port of the existing upload logic from `src/routes/library/+page.svelte:53-248` with a slimmer drop zone and a two-column metadata grid. All behaviour — mp3-only validation, duplicate detection, per-file status, sequential upload, retry of failed files — is preserved.

```svelte
<script lang="ts">
  import { CheckCircle2, CircleAlert, CircleDashed, LoaderCircle, Upload, X } from '@lucide/svelte';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import * as Field from '$lib/components/ui/field';
  import { Input } from '$lib/components/ui/input';
  import { Progress } from '$lib/components/ui/progress';
  import * as ScrollArea from '$lib/components/ui/scroll-area';
  import * as Select from '$lib/components/ui/select';
  import { Spinner } from '$lib/components/ui/spinner';
  import { ASSET_ICONS, type AssetIcon } from '$lib/asset-metadata';
  import { useSoundkeep } from '$lib/soundkeep-client.svelte';
  import type { AssetRole } from '$lib/types';
  import { cn, formatBytes } from '$lib/utils';

  type UploadStatus = 'queued' | 'uploading' | 'success' | 'error';

  interface UploadQueueItem {
    id: string;
    file: File;
    suggestedName: string;
    status: UploadStatus;
    error: string;
  }

  const soundkeep = useSoundkeep();

  let queue = $state<UploadQueueItem[]>([]);
  let name = $state('');
  let category = $state('Imported');
  let role = $state<AssetRole>('ambience');
  let subtitle = $state('');
  let mood = $state('');
  let icon = $state<AssetIcon>('audio-lines');
  let uploading = $state(false);
  let dragActive = $state(false);

  let completed = $derived(
    queue.filter((item) => item.status === 'success' || item.status === 'error').length
  );
  let pending = $derived(
    queue.filter((item) => item.status === 'queued' || item.status === 'error').length
  );
  let progress = $derived(queue.length === 0 ? 0 : Math.round((completed / queue.length) * 100));

  function humanizeFilename(filename: string) {
    const withoutExtension = filename.replace(/\.mp3$/i, '');
    const spaced = withoutExtension.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!spaced) return 'Untitled sound';
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }

  function iconLabel(value: AssetIcon) {
    return value
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  function statusLabel(status: UploadStatus) {
    if (status === 'uploading') return 'Uploading';
    if (status === 'success') return 'Added';
    if (status === 'error') return 'Failed';
    return 'Queued';
  }

  function addFiles(files: File[]) {
    if (uploading) return;
    const mp3Files = files.filter((file) => file.name.toLowerCase().endsWith('.mp3'));
    if (mp3Files.length !== files.length) {
      soundkeep.showError(new Error('Only .mp3 files can be added to Soundkeep.'));
    }
    if (mp3Files.length === 0) return;

    const existing = new Set(
      queue.map((item) => `${item.file.name}:${item.file.size}:${item.file.lastModified}`)
    );
    const additions = mp3Files
      .filter((file) => !existing.has(`${file.name}:${file.size}:${file.lastModified}`))
      .map((file) => ({
        id: crypto.randomUUID(),
        file,
        suggestedName: humanizeFilename(file.name),
        status: 'queued' as const,
        error: ''
      }));

    queue.push(...additions);
    name = queue.length === 1 ? queue[0].suggestedName : '';

    const input = document.querySelector<HTMLInputElement>('#audio-upload');
    if (input) input.value = '';
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    dragActive = false;
    addFiles(Array.from(event.dataTransfer?.files ?? []));
  }

  function removeQueued(id: string) {
    if (uploading) return;
    queue = queue.filter((item) => item.id !== id);
    name = queue.length === 1 ? queue[0].suggestedName : '';
  }

  function clearFinished() {
    if (uploading) return;
    queue = queue.filter((item) => item.status !== 'success' && item.status !== 'error');
    name = queue.length === 1 ? queue[0].suggestedName : '';
  }

  async function upload() {
    const uploadable = queue.filter((item) => item.status === 'queued' || item.status === 'error');
    if (uploadable.length === 0) {
      soundkeep.showError(new Error('Choose one or more MP3 files first.'));
      return;
    }

    uploading = true;
    const single = queue.length === 1;
    for (const item of uploadable) {
      item.status = 'uploading';
      item.error = '';
      const displayName = single && name.trim() ? name.trim() : item.suggestedName;
      const done = await soundkeep.uploadAsset(
        item.file,
        {
          name: displayName,
          category: category.trim(),
          role,
          subtitle: subtitle.trim(),
          mood: mood.trim(),
          icon
        },
        displayName,
        single
      );
      item.status = done ? 'success' : 'error';
      item.error = done ? '' : 'Upload failed. You can retry this file.';
    }
    uploading = false;
  }
</script>

<Card.Root class="min-w-0">
  <Card.Header class="pb-2">
    <Card.Title class="text-base">Add MP3s</Card.Title>
    <Card.Description class="text-micro">
      Drop a batch here or choose files. Uploads are processed one at a time.
    </Card.Description>
  </Card.Header>
  <Card.Content>
    <form
      onsubmit={(event) => {
        event.preventDefault();
        void upload();
      }}
    >
      <Field.Group class="gap-3">
        <Field.Field>
          <Field.Label for="audio-upload">MP3 files</Field.Label>
          <div
            role="region"
            aria-label="MP3 upload drop zone"
            class={cn(
              'bg-muted/30 flex flex-col items-center gap-2 rounded-lg border border-dashed p-3 text-center transition-colors',
              dragActive && 'bg-accent border-primary'
            )}
            ondragenter={(event) => {
              event.preventDefault();
              dragActive = true;
            }}
            ondragover={(event) => {
              event.preventDefault();
              dragActive = true;
            }}
            ondragleave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                dragActive = false;
              }
            }}
            ondrop={handleDrop}
          >
            <p class="flex items-center gap-2 text-xs font-medium">
              <Upload class="size-4" />
              Drop MP3 files here
            </p>
            <Input
              id="audio-upload"
              type="file"
              accept=".mp3,audio/mpeg"
              multiple
              disabled={uploading}
              onchange={(event) =>
                addFiles(Array.from((event.currentTarget as HTMLInputElement).files ?? []))}
            />
          </div>
          <Field.Description class="text-micro">
            Only MP3 audio is accepted. Short sound effects are prewarmed for fast playback.
          </Field.Description>
        </Field.Field>

        {#if queue.length > 0}
          <Field.Field>
            <div class="flex items-center justify-between gap-3">
              <Field.Label>Upload queue</Field.Label>
              {#if completed > 0 && !uploading}
                <Button type="button" variant="ghost" size="xs" onclick={clearFinished}>
                  Clear finished
                </Button>
              {/if}
            </div>
            <div class="flex items-center justify-between gap-2">
              <span class="metric-label">{completed} of {queue.length} processed</span>
              <span class="metric">{progress}%</span>
            </div>
            <Progress value={progress} aria-label="Overall upload progress" />
            <ScrollArea.Root class="h-36 rounded-md border">
              <div class="flex flex-col p-1.5">
                {#each queue as item (item.id)}
                  <div class="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1">
                    <span class="text-muted-foreground shrink-0">
                      {#if item.status === 'uploading'}
                        <LoaderCircle class="size-3.5 animate-spin" />
                      {:else if item.status === 'success'}
                        <CheckCircle2 class="size-3.5" />
                      {:else if item.status === 'error'}
                        <CircleAlert class="size-3.5" />
                      {:else}
                        <CircleDashed class="size-3.5" />
                      {/if}
                    </span>
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-xs font-medium">{item.suggestedName}</span>
                      <span class="metric-label block truncate">
                        {item.error ||
                          `${formatBytes(item.file.size)} · ${statusLabel(item.status)}`}
                      </span>
                    </span>
                    <Badge variant={item.status === 'error' ? 'warning' : 'outline'}>
                      {statusLabel(item.status)}
                    </Badge>
                    {#if item.status !== 'uploading'}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Remove ${item.file.name} from upload queue`}
                        disabled={uploading}
                        onclick={() => removeQueued(item.id)}
                      >
                        <X />
                      </Button>
                    {/if}
                  </div>
                {/each}
              </div>
            </ScrollArea.Root>
          </Field.Field>
        {/if}

        <Field.Field data-disabled={queue.length !== 1}>
          <Field.Label for="upload-name">Display name</Field.Label>
          <Input
            id="upload-name"
            class="h-8"
            placeholder={queue.length > 1 ? 'Each file uses its filename' : 'e.g. Distant thunder'}
            disabled={queue.length !== 1 || uploading}
            bind:value={name}
          />
          <Field.Description class="text-micro">
            {queue.length > 1
              ? 'Batch uploads receive readable names from their filenames.'
              : 'The MP3 filename is converted into a readable default.'}
          </Field.Description>
        </Field.Field>

        <div class="grid gap-3 sm:grid-cols-2">
          <Field.Field>
            <Field.Label for="upload-category">Category</Field.Label>
            <Input
              id="upload-category"
              class="h-8"
              placeholder="e.g. Weather"
              disabled={uploading}
              bind:value={category}
            />
          </Field.Field>
          <Field.Field>
            <Field.Label for="upload-role">Placement</Field.Label>
            <Select.Root type="single" disabled={uploading} bind:value={role}>
              <Select.Trigger id="upload-role" class="h-8 w-full">
                <span>{role === 'ambience' ? 'Background' : 'Soundboard'}</span>
              </Select.Trigger>
              <Select.Content>
                <Select.Group>
                  <Select.Item value="ambience">Background</Select.Item>
                  <Select.Item value="soundboard">Soundboard</Select.Item>
                </Select.Group>
              </Select.Content>
            </Select.Root>
          </Field.Field>
          <Field.Field>
            <Field.Label for="upload-mood">Mood</Field.Label>
            <Input
              id="upload-mood"
              class="h-8"
              placeholder="e.g. Ominous"
              disabled={uploading}
              bind:value={mood}
            />
          </Field.Field>
          <Field.Field>
            <Field.Label for="upload-icon">Icon</Field.Label>
            <Select.Root type="single" disabled={uploading} bind:value={icon}>
              <Select.Trigger id="upload-icon" class="h-8 w-full">
                <span>{iconLabel(icon)}</span>
              </Select.Trigger>
              <Select.Content>
                <Select.Group>
                  {#each ASSET_ICONS as value (value)}
                    <Select.Item {value}>{iconLabel(value)}</Select.Item>
                  {/each}
                </Select.Group>
              </Select.Content>
            </Select.Root>
          </Field.Field>
        </div>

        <Field.Field>
          <Field.Label for="upload-subtitle">Subtitle</Field.Label>
          <Input
            id="upload-subtitle"
            class="h-8"
            placeholder="Optional short description"
            disabled={uploading}
            bind:value={subtitle}
          />
        </Field.Field>

        <Button type="submit" disabled={pending === 0 || uploading || soundkeep.busy !== null}>
          {#if uploading}
            <Spinner data-icon="inline-start" />
            Uploading {Math.min(completed + 1, queue.length)} of {queue.length}
          {:else}
            <Upload data-icon="inline-start" />
            {queue.length === 0
              ? 'Add MP3s'
              : queue.length === 1
                ? 'Add MP3'
                : `Add ${pending} MP3s`}
          {/if}
        </Button>
      </Field.Group>
    </form>
  </Card.Content>
</Card.Root>
```

- [ ] **Step 2: Create `src/lib/components/soundkeep/storage-panel.svelte`**

```svelte
<script lang="ts">
  import { HardDrive } from '@lucide/svelte';
  import * as Card from '$lib/components/ui/card';
  import StatRow from '$lib/components/soundkeep/stat-row.svelte';
  import { useSoundkeep } from '$lib/soundkeep-client.svelte';
  import { formatBytes } from '$lib/utils';

  const soundkeep = useSoundkeep();
</script>

<Card.Root class="min-w-0">
  <Card.Header class="pb-2">
    <Card.Title class="flex items-center gap-2 text-sm tracking-wide uppercase">
      <HardDrive class="size-4" />
      Storage
    </Card.Title>
    <Card.Description class="text-micro">
      Audio and artwork persist in the configured volume.
    </Card.Description>
  </Card.Header>
  <Card.Content class="pb-3">
    <StatRow label="Local audio" value={formatBytes(soundkeep.totalLocalBytes)} />
    <StatRow label="Background assets" value={soundkeep.backgroundAssets.length} />
    <StatRow label="Soundboard buttons" value={soundkeep.soundboardAssets.length} />
    <StatRow label="Cached effects" value={soundkeep.state.pcmCache.entries} />
  </Card.Content>
</Card.Root>
```

- [ ] **Step 3: Create `src/lib/components/soundkeep/asset-table.svelte`**

Row action accessible names `Add <name> to soundboard` and `Remove <name> from soundboard` are part of the end-to-end contract. Keep them as plain buttons, not menu items.

```svelte
<script lang="ts">
  import { FileAudio, ListFilter, Pencil, Play, Plus, Search, Trash2, X } from '@lucide/svelte';
  import * as Avatar from '$lib/components/ui/avatar';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import * as Empty from '$lib/components/ui/empty';
  import * as InputGroup from '$lib/components/ui/input-group';
  import * as ScrollArea from '$lib/components/ui/scroll-area';
  import * as Select from '$lib/components/ui/select';
  import * as Table from '$lib/components/ui/table';
  import AssetIconGlyph from '$lib/components/soundkeep/asset-icon.svelte';
  import { useSoundkeep } from '$lib/soundkeep-client.svelte';
  import type { AssetRole, AudioAsset } from '$lib/types';
  import { formatBytes, formatDuration } from '$lib/utils';

  let {
    onedit,
    ondelete
  }: { onedit: (asset: AudioAsset) => void; ondelete: (asset: AudioAsset) => void } = $props();

  const soundkeep = useSoundkeep();

  let search = $state('');
  let placement = $state<'all' | AssetRole>('all');

  let filtered = $derived(
    soundkeep.state.assets.filter((asset) => {
      const query = search.trim().toLowerCase();
      const matchesPlacement = placement === 'all' || asset.role === placement;
      const matchesSearch =
        !query ||
        asset.name.toLowerCase().includes(query) ||
        asset.category.toLowerCase().includes(query) ||
        asset.subtitle.toLowerCase().includes(query) ||
        asset.mood.toLowerCase().includes(query);
      return matchesPlacement && matchesSearch;
    })
  );

  let placementLabel = $derived(
    placement === 'all' ? 'All placements' : placement === 'ambience' ? 'Background' : 'Soundboard'
  );
</script>

<Card.Root class="min-w-0">
  <Card.Header class="pb-2">
    <div class="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
      <div class="min-w-0">
        <Card.Title class="text-base">Assets</Card.Title>
        <Card.Description class="text-micro">
          Search, preview, classify, and customize every uploaded MP3.
        </Card.Description>
      </div>
      <div class="flex w-full flex-col gap-1.5 sm:flex-row xl:max-w-md">
        <InputGroup.Root class="h-8 min-w-0 flex-1">
          <InputGroup.Addon><Search /></InputGroup.Addon>
          <InputGroup.Input
            aria-label="Search library"
            placeholder="Search name, category, mood…"
            bind:value={search}
          />
        </InputGroup.Root>
        <Select.Root type="single" bind:value={placement}>
          <Select.Trigger aria-label="Filter library by placement" class="h-8 w-full sm:w-40">
            <ListFilter />
            <span>{placementLabel}</span>
          </Select.Trigger>
          <Select.Content>
            <Select.Group>
              <Select.Item value="all">All placements</Select.Item>
              <Select.Item value="ambience">Background</Select.Item>
              <Select.Item value="soundboard">Soundboard</Select.Item>
            </Select.Group>
          </Select.Content>
        </Select.Root>
      </div>
    </div>
  </Card.Header>
  <Card.Content>
    {#if filtered.length === 0}
      <Empty.Root>
        <Empty.Header>
          <Empty.Media variant="icon"><FileAudio /></Empty.Media>
          <Empty.Title>
            {soundkeep.state.assets.length ? 'No matching MP3s' : 'Library is empty'}
          </Empty.Title>
          <Empty.Description>
            {soundkeep.state.assets.length
              ? 'Try a broader search or another placement.'
              : 'Upload an MP3 to get started.'}
          </Empty.Description>
        </Empty.Header>
      </Empty.Root>
    {:else}
      <ScrollArea.Root orientation="horizontal" class="w-full">
        <Table.Root class="min-w-[720px]">
          <Table.Header>
            <Table.Row>
              <Table.Head class="text-micro">Asset</Table.Head>
              <Table.Head class="text-micro">Metadata</Table.Head>
              <Table.Head class="text-micro">Placement</Table.Head>
              <Table.Head class="text-micro">Length</Table.Head>
              <Table.Head class="text-micro text-right">Actions</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each filtered as asset (asset.id)}
              <Table.Row>
                <Table.Cell class="py-1.5">
                  <div class="flex min-w-0 items-center gap-2">
                    <Avatar.Root class="size-8 shrink-0 rounded-sm after:rounded-sm">
                      {#if asset.artworkFilename}
                        <Avatar.Image
                          src={`/api/library/${asset.id}/artwork?v=${encodeURIComponent(asset.updatedAt)}`}
                          alt=""
                          class="rounded-sm"
                        />
                      {/if}
                      <Avatar.Fallback class="rounded-sm">
                        <AssetIconGlyph icon={asset.icon} class="size-3.5" />
                      </Avatar.Fallback>
                    </Avatar.Root>
                    <div class="min-w-0">
                      <p class="max-w-56 truncate text-xs font-medium">{asset.name}</p>
                      <p class="metric-label max-w-56 truncate">
                        {asset.subtitle || asset.originalFilename}
                      </p>
                    </div>
                  </div>
                </Table.Cell>
                <Table.Cell class="py-1.5">
                  <div class="flex items-center gap-1">
                    <Badge variant="outline">{asset.category || 'Uncategorized'}</Badge>
                    {#if asset.mood}
                      <Badge variant="secondary">{asset.mood}</Badge>
                    {/if}
                    <span class="metric-label tabular-nums">{formatBytes(asset.size)}</span>
                  </div>
                </Table.Cell>
                <Table.Cell class="py-1.5">
                  <Badge variant={asset.role === 'soundboard' ? 'secondary' : 'outline'}>
                    {asset.role === 'soundboard' ? 'Soundboard' : 'Background'}
                  </Badge>
                </Table.Cell>
                <Table.Cell class="metric-label py-1.5 tabular-nums">
                  {formatDuration(asset.duration)}
                </Table.Cell>
                <Table.Cell class="py-1.5">
                  <div class="flex justify-end gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Preview ${asset.name}`}
                      onclick={() => soundkeep.preview(asset)}
                    >
                      <Play />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={asset.role === 'soundboard'
                        ? `Remove ${asset.name} from soundboard`
                        : `Add ${asset.name} to soundboard`}
                      disabled={soundkeep.busy !== null}
                      onclick={() =>
                        soundkeep.setAssetRole(
                          asset,
                          asset.role === 'soundboard' ? 'ambience' : 'soundboard'
                        )}
                    >
                      {#if asset.role === 'soundboard'}<X />{:else}<Plus />{/if}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Edit ${asset.name}`}
                      onclick={() => onedit(asset)}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete ${asset.name}`}
                      onclick={() => ondelete(asset)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      </ScrollArea.Root>
    {/if}
  </Card.Content>
</Card.Root>
```

- [ ] **Step 4: Create `src/lib/components/soundkeep/asset-edit-dialog.svelte`**

Port of `src/routes/library/+page.svelte:774-917` plus the artwork handlers at lines 250-323.

```svelte
<script lang="ts">
  import { Image, ImageOff } from '@lucide/svelte';
  import * as Avatar from '$lib/components/ui/avatar';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Field from '$lib/components/ui/field';
  import { Input } from '$lib/components/ui/input';
  import * as Select from '$lib/components/ui/select';
  import { Spinner } from '$lib/components/ui/spinner';
  import AssetIconGlyph from '$lib/components/soundkeep/asset-icon.svelte';
  import { ASSET_ICONS, type AssetIcon } from '$lib/asset-metadata';
  import { useSoundkeep } from '$lib/soundkeep-client.svelte';
  import type { AssetRole, AudioAsset } from '$lib/types';

  let { open = $bindable(false), asset }: { open?: boolean; asset: AudioAsset | null } = $props();

  const soundkeep = useSoundkeep();

  let current = $state<AudioAsset | null>(null);
  let name = $state('');
  let category = $state('');
  let role = $state<AssetRole>('ambience');
  let subtitle = $state('');
  let mood = $state('');
  let icon = $state<AssetIcon>('audio-lines');
  let artworkFile = $state<File | null>(null);
  let artworkPreviewUrl = $state<string | null>(null);

  let artworkSource = $derived(
    artworkPreviewUrl ??
      (current?.artworkFilename
        ? `/api/library/${current.id}/artwork?v=${encodeURIComponent(current.updatedAt)}`
        : null)
  );

  $effect(() => {
    if (!open || !asset) return;
    clearArtwork();
    current = asset;
    name = asset.name;
    category = asset.category;
    role = asset.role;
    subtitle = asset.subtitle;
    mood = asset.mood;
    icon = asset.icon;
  });

  function iconLabel(value: AssetIcon) {
    return value
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  function clearArtwork() {
    if (artworkPreviewUrl) URL.revokeObjectURL(artworkPreviewUrl);
    artworkPreviewUrl = null;
    artworkFile = null;
    const input = document.querySelector<HTMLInputElement>('#edit-artwork');
    if (input) input.value = '';
  }

  function close() {
    open = false;
    clearArtwork();
  }

  function selectArtwork(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (!file) return;
    if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
      soundkeep.showError(new Error('Artwork must be a PNG or JPEG image.'));
      input.value = '';
      return;
    }
    clearArtwork();
    artworkFile = file;
    artworkPreviewUrl = URL.createObjectURL(file);
  }

  function refreshCurrent(id: string) {
    current = soundkeep.state.assets.find((item) => item.id === id) ?? current;
  }

  async function uploadArtwork() {
    if (!current || !artworkFile) return;
    const id = current.id;
    if (await soundkeep.uploadArtwork(current, artworkFile)) {
      refreshCurrent(id);
      clearArtwork();
    }
  }

  async function removeArtwork() {
    if (!current) return;
    const id = current.id;
    if (await soundkeep.removeArtwork(current)) {
      refreshCurrent(id);
      clearArtwork();
    }
  }

  async function save() {
    if (!current) return;
    const done = await soundkeep.updateAsset(
      current,
      { name, category, role, subtitle, mood, icon },
      'Library entry updated.'
    );
    if (done) close();
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
    <Dialog.Header>
      <Dialog.Title>Edit library item</Dialog.Title>
      <Dialog.Description>
        Refine how this MP3 appears in the library, scenes, and soundboard.
      </Dialog.Description>
    </Dialog.Header>

    <Field.Group class="gap-3">
      <Field.Set>
        <Field.Legend>Presentation</Field.Legend>
        <Field.Description>Artwork is optional and may be a PNG or JPEG.</Field.Description>
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start">
          <Avatar.Root class="size-20 shrink-0">
            {#if artworkSource}
              <Avatar.Image src={artworkSource} alt="" />
            {/if}
            <Avatar.Fallback><AssetIconGlyph {icon} /></Avatar.Fallback>
          </Avatar.Root>
          <Field.Field class="flex-1">
            <Field.Label for="edit-artwork">Artwork</Field.Label>
            <Input
              id="edit-artwork"
              type="file"
              accept="image/png,image/jpeg"
              disabled={soundkeep.busy !== null}
              onchange={selectArtwork}
            />
            <Field.Description class="text-micro">
              PNG or JPEG, up to the server artwork limit.
            </Field.Description>
            <div class="flex flex-wrap gap-1.5">
              <Button
                type="button"
                size="sm"
                disabled={!artworkFile || soundkeep.busy !== null}
                onclick={uploadArtwork}
              >
                {#if soundkeep.busy?.startsWith('artwork-')}
                  <Spinner data-icon="inline-start" />
                {:else}
                  <Image data-icon="inline-start" />
                {/if}
                Save artwork
              </Button>
              {#if current?.artworkFilename}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={soundkeep.busy !== null}
                  onclick={removeArtwork}
                >
                  <ImageOff data-icon="inline-start" />
                  Remove artwork
                </Button>
              {/if}
            </div>
          </Field.Field>
        </div>
      </Field.Set>

      <Field.Separator />

      <Field.Set>
        <Field.Legend>Metadata</Field.Legend>
        <Field.Description>
          These labels make large sound libraries easier to scan and search.
        </Field.Description>
        <Field.Group class="gap-3">
          <div class="grid gap-3 sm:grid-cols-2">
            <Field.Field>
              <Field.Label for="edit-name">Display name</Field.Label>
              <Input id="edit-name" class="h-8" bind:value={name} />
            </Field.Field>
            <Field.Field>
              <Field.Label for="edit-category">Category</Field.Label>
              <Input id="edit-category" class="h-8" bind:value={category} />
            </Field.Field>
          </div>
          <Field.Field>
            <Field.Label for="edit-subtitle">Subtitle</Field.Label>
            <Input
              id="edit-subtitle"
              class="h-8"
              placeholder="Short descriptive line"
              bind:value={subtitle}
            />
          </Field.Field>
          <div class="grid gap-3 sm:grid-cols-3">
            <Field.Field>
              <Field.Label for="edit-mood">Mood</Field.Label>
              <Input id="edit-mood" class="h-8" placeholder="e.g. Ominous" bind:value={mood} />
            </Field.Field>
            <Field.Field>
              <Field.Label for="edit-icon">Icon</Field.Label>
              <Select.Root type="single" bind:value={icon}>
                <Select.Trigger id="edit-icon" class="h-8 w-full">
                  <span>{iconLabel(icon)}</span>
                </Select.Trigger>
                <Select.Content>
                  <Select.Group>
                    {#each ASSET_ICONS as value (value)}
                      <Select.Item {value}>{iconLabel(value)}</Select.Item>
                    {/each}
                  </Select.Group>
                </Select.Content>
              </Select.Root>
            </Field.Field>
            <Field.Field>
              <Field.Label for="edit-role">Placement</Field.Label>
              <Select.Root type="single" bind:value={role}>
                <Select.Trigger id="edit-role" class="h-8 w-full">
                  <span>{role === 'ambience' ? 'Background' : 'Soundboard'}</span>
                </Select.Trigger>
                <Select.Content>
                  <Select.Group>
                    <Select.Item value="ambience">Background</Select.Item>
                    <Select.Item value="soundboard">Soundboard</Select.Item>
                  </Select.Group>
                </Select.Content>
              </Select.Root>
            </Field.Field>
          </div>
        </Field.Group>
      </Field.Set>
    </Field.Group>

    <Dialog.Footer>
      <Button variant="outline" onclick={close}>Cancel</Button>
      <Button disabled={!name.trim() || soundkeep.busy !== null} onclick={save}>
        {#if soundkeep.busy?.startsWith('edit-')}<Spinner data-icon="inline-start" />{/if}
        Save changes
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
```

- [ ] **Step 5: Create `src/lib/components/soundkeep/asset-delete-dialog.svelte`**

```svelte
<script lang="ts">
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import { Spinner } from '$lib/components/ui/spinner';
  import { useSoundkeep } from '$lib/soundkeep-client.svelte';
  import type { AudioAsset } from '$lib/types';

  let { asset, onclose }: { asset: AudioAsset | null; onclose: () => void } = $props();

  const soundkeep = useSoundkeep();

  async function confirm() {
    if (!asset) return;
    if (await soundkeep.deleteAsset(asset)) onclose();
  }
</script>

<AlertDialog.Root open={asset !== null} onOpenChange={(open) => !open && onclose()}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Delete “{asset?.name}”?</AlertDialog.Title>
      <AlertDialog.Description>
        This removes the library entry, saved MP3, artwork, and scene references. This cannot be
        undone.
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action
        variant="destructive"
        disabled={!asset || soundkeep.busy !== null}
        onclick={confirm}
      >
        {#if soundkeep.busy?.startsWith('delete-')}<Spinner data-icon="inline-start" />{/if}
        Delete
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
```

- [ ] **Step 6: Rewrite `src/routes/library/+page.svelte`**

Replace the entire file with:

```svelte
<script lang="ts">
  import { Badge } from '$lib/components/ui/badge';
  import AssetDeleteDialog from '$lib/components/soundkeep/asset-delete-dialog.svelte';
  import AssetEditDialog from '$lib/components/soundkeep/asset-edit-dialog.svelte';
  import AssetTable from '$lib/components/soundkeep/asset-table.svelte';
  import AssetUploadPanel from '$lib/components/soundkeep/asset-upload-panel.svelte';
  import StoragePanel from '$lib/components/soundkeep/storage-panel.svelte';
  import { useSoundkeep } from '$lib/soundkeep-client.svelte';
  import type { AudioAsset } from '$lib/types';
  import { formatBytes } from '$lib/utils';

  const soundkeep = useSoundkeep();

  let editOpen = $state(false);
  let editingAsset = $state<AudioAsset | null>(null);
  let deletingAsset = $state<AudioAsset | null>(null);
</script>

<div class="flex min-w-0 flex-1 flex-col">
  <div
    class="bg-card/35 flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-2 md:px-4"
  >
    <div class="min-w-0">
      <h1 class="font-display text-base font-semibold tracking-tight">Audio library</h1>
      <p class="metric-label truncate">
        Upload MP3s, shape their presentation, and organize the session control surface.
      </p>
    </div>
    <div class="flex flex-wrap items-center gap-1.5">
      <Badge variant="outline">{soundkeep.state.assets.length} assets</Badge>
      <Badge variant="outline">{formatBytes(soundkeep.totalLocalBytes)} local</Badge>
    </div>
  </div>

  <div
    class="grid min-w-0 flex-1 items-start gap-3 p-3 md:p-4 2xl:grid-cols-[minmax(340px,0.75fr)_minmax(0,2fr)]"
  >
    <div class="flex min-w-0 flex-col gap-3">
      <AssetUploadPanel />
      <StoragePanel />
    </div>

    <AssetTable
      onedit={(asset) => {
        editingAsset = asset;
        editOpen = true;
      }}
      ondelete={(asset) => (deletingAsset = asset)}
    />
  </div>
</div>

<AssetEditDialog bind:open={editOpen} asset={editingAsset} />
<AssetDeleteDialog asset={deletingAsset} onclose={() => (deletingAsset = null)} />
```

- [ ] **Step 7: Verify the library page**

Run: `npm run format && npm run lint && npm run check && npm run build && npm run test:run`
Expected: all succeed.

- [ ] **Step 8: Commit**

```bash
git add src/lib/components/soundkeep src/routes/library/+page.svelte
git commit -m "feat(ui): rebuild the audio library as dense panels and rows"
```

---

### Task 7: Settings rewrite

**Files:**

- Create: `src/lib/components/soundkeep/settings/voice-panel.svelte`
- Create: `src/lib/components/soundkeep/settings/quality-panel.svelte`
- Create: `src/lib/components/soundkeep/settings/master-output-panel.svelte`
- Create: `src/lib/components/soundkeep/settings/bot-status-panel.svelte`
- Create: `src/lib/components/soundkeep/settings/capabilities-panel.svelte`
- Create: `src/lib/components/soundkeep/settings/diagnostics-panel.svelte`
- Modify: `src/routes/settings/+page.svelte` (full rewrite)

**Interfaces:**

- Consumes: `StatRow`; `useSoundkeep()`; `isDiscordBitrateMode` and `DiscordBitrateMode` from `$lib/audio-quality`; `formatBytes`.
- Produces: six no-prop panel components.

- [ ] **Step 1: Create `src/lib/components/soundkeep/settings/voice-panel.svelte`**

```svelte
<script lang="ts">
  import { Headphones, LogOut, Radio } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import * as Field from '$lib/components/ui/field';
  import * as Select from '$lib/components/ui/select';
  import { Spinner } from '$lib/components/ui/spinner';
  import { useSoundkeep } from '$lib/soundkeep-client.svelte';

  const soundkeep = useSoundkeep();

  let selectedChannel = $state(
    soundkeep.state.discord.channelId ??
      soundkeep.state.guilds.flatMap((guild) => guild.voiceChannels)[0]?.id ??
      ''
  );

  $effect(() => {
    if (!selectedChannel) {
      selectedChannel =
        soundkeep.state.discord.channelId ??
        soundkeep.state.guilds.flatMap((guild) => guild.voiceChannels)[0]?.id ??
        '';
    }
  });
</script>

<Card.Root class="min-w-0">
  <Card.Header class="pb-2">
    <Card.Title class="flex items-center gap-2 text-base">
      <Headphones class="size-4" />
      Discord voice
    </Card.Title>
    <Card.Description class="text-micro">
      Choose the server channel that receives the live two-line mix.
    </Card.Description>
  </Card.Header>
  <Card.Content>
    <Field.Group class="gap-3">
      <Field.Field>
        <Field.Label for="voice-channel">Voice channel</Field.Label>
        <Select.Root type="single" bind:value={selectedChannel}>
          <Select.Trigger id="voice-channel" class="h-8 w-full">
            <span class="truncate">{soundkeep.channelLabel(selectedChannel)}</span>
          </Select.Trigger>
          <Select.Content>
            {#each soundkeep.state.guilds as guild (guild.id)}
              <Select.Group>
                <Select.Label>{guild.name}</Select.Label>
                {#each guild.voiceChannels as channel (channel.id)}
                  <Select.Item value={channel.id}>{channel.name}</Select.Item>
                {/each}
              </Select.Group>
            {/each}
          </Select.Content>
        </Select.Root>
        <Field.Description class="text-micro">
          Soundkeep can send audio to one voice channel at a time.
        </Field.Description>
      </Field.Field>
      <div class="flex justify-end">
        {#if soundkeep.state.discord.connected}
          <Button
            variant="outline"
            size="sm"
            disabled={soundkeep.busy !== null}
            onclick={() => soundkeep.disconnect()}
          >
            {#if soundkeep.busy === 'disconnect'}
              <Spinner data-icon="inline-start" />
            {:else}
              <LogOut data-icon="inline-start" />
            {/if}
            Disconnect
          </Button>
        {:else}
          <Button
            size="sm"
            disabled={!selectedChannel || !soundkeep.state.discord.ready || soundkeep.busy !== null}
            onclick={() => soundkeep.connect(selectedChannel)}
          >
            {#if soundkeep.busy === 'connect'}
              <Spinner data-icon="inline-start" />
            {:else}
              <Radio data-icon="inline-start" />
            {/if}
            Connect
          </Button>
        {/if}
      </div>
    </Field.Group>
  </Card.Content>
</Card.Root>
```

- [ ] **Step 2: Create `src/lib/components/soundkeep/settings/quality-panel.svelte`**

The heading text `Discord audio quality`, the four radio names, and the `Apply bitrate` button name are part of the end-to-end contract, as are the visible strings `Configured`, `Current output`, and `Inactive`.

```svelte
<script lang="ts">
  import { Gauge } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import * as Field from '$lib/components/ui/field';
  import { Spinner } from '$lib/components/ui/spinner';
  import * as ToggleGroup from '$lib/components/ui/toggle-group';
  import StatRow from '$lib/components/soundkeep/stat-row.svelte';
  import { isDiscordBitrateMode, type DiscordBitrateMode } from '$lib/audio-quality';
  import { useSoundkeep } from '$lib/soundkeep-client.svelte';

  const soundkeep = useSoundkeep();

  let mode = $state<DiscordBitrateMode>(soundkeep.state.discord.audioDiagnostics.bitrateMode);
  let dirty = $state(false);

  $effect(() => {
    if (!dirty && soundkeep.busy !== 'discord-bitrate') {
      mode = soundkeep.state.discord.audioDiagnostics.bitrateMode;
    }
  });

  function select(value: string) {
    if (!isDiscordBitrateMode(value)) return;
    mode = value;
    dirty = value !== soundkeep.state.discord.audioDiagnostics.bitrateMode;
  }

  async function apply() {
    const applied = await soundkeep.changeDiscordBitrate(mode);
    dirty = false;
    if (!applied) mode = soundkeep.state.discord.audioDiagnostics.bitrateMode;
  }

  function bitrateLabel(value: number | null, fallback: string) {
    return value === null ? fallback : `${Math.round(value / 1_000)} kbps`;
  }

  function modeLabel(value: DiscordBitrateMode) {
    return value === 'auto' ? 'Auto' : `${Math.round(Number(value) / 1_000)} kbps`;
  }
</script>

<Card.Root class="min-w-0">
  <Card.Header class="pb-2">
    <Card.Title class="flex items-center gap-2 text-base">
      <Gauge class="size-4" />
      Discord audio quality
    </Card.Title>
    <Card.Description class="text-micro">
      Choose the Opus quality target used for the final stereo mix.
    </Card.Description>
  </Card.Header>
  <Card.Content>
    <Field.Group class="gap-3">
      <Field.Field>
        <Field.Label id="discord-bitrate-label">Opus bitrate</Field.Label>
        <ToggleGroup.Root
          type="single"
          variant="outline"
          spacing={1}
          value={mode}
          onValueChange={select}
          disabled={soundkeep.busy !== null}
          aria-labelledby="discord-bitrate-label"
          class="w-full flex-wrap"
        >
          <ToggleGroup.Item value="auto" class="flex-1">Auto</ToggleGroup.Item>
          <ToggleGroup.Item value="64000" class="flex-1">64 kbps</ToggleGroup.Item>
          <ToggleGroup.Item value="96000" class="flex-1">96 kbps</ToggleGroup.Item>
          <ToggleGroup.Item value="128000" class="flex-1">128 kbps</ToggleGroup.Item>
        </ToggleGroup.Root>
        <Field.Description class="text-micro">
          Auto uses the Discord channel limit up to 128 kbps. Fixed choices are also capped by the
          channel.
        </Field.Description>
      </Field.Field>
      <div>
        <StatRow
          label="Configured"
          value={dirty
            ? `${modeLabel(soundkeep.state.discord.audioDiagnostics.bitrateMode)} → ${modeLabel(mode)} pending`
            : modeLabel(soundkeep.state.discord.audioDiagnostics.bitrateMode)}
        />
        <StatRow
          label="Channel limit"
          value={bitrateLabel(
            soundkeep.state.discord.audioDiagnostics.channelBitrate,
            'Not connected'
          )}
        />
        <StatRow
          label="Current output"
          value={`${bitrateLabel(soundkeep.state.discord.audioDiagnostics.bitrate, 'Inactive')}${
            soundkeep.state.discord.audioDiagnostics.bitrateReconfiguring ? ' (updating)' : ''
          }`}
        />
      </div>
      <div class="flex justify-end">
        <Button size="sm" disabled={!dirty || soundkeep.busy !== null} onclick={apply}>
          {#if soundkeep.busy === 'discord-bitrate'}
            <Spinner data-icon="inline-start" />
          {/if}
          Apply bitrate
        </Button>
      </div>
    </Field.Group>
  </Card.Content>
</Card.Root>
```

- [ ] **Step 3: Create `src/lib/components/soundkeep/settings/master-output-panel.svelte`**

`Master output` must remain a heading on this page.

```svelte
<script lang="ts">
  import { Volume2 } from '@lucide/svelte';
  import * as Card from '$lib/components/ui/card';
  import { Slider } from '$lib/components/ui/slider';
  import { useSoundkeep } from '$lib/soundkeep-client.svelte';

  const soundkeep = useSoundkeep();

  let masterPercent = $state(Math.round(soundkeep.state.masterVolume * 100));

  $effect(() => {
    masterPercent = Math.round(soundkeep.state.masterVolume * 100);
  });

  async function change(event: Event) {
    masterPercent = Number((event.currentTarget as HTMLInputElement).value);
    await soundkeep.changeMasterVolume(masterPercent / 100);
  }
</script>

<Card.Root class="min-w-0">
  <Card.Header class="pb-2">
    <Card.Title class="flex items-center gap-2 text-base">
      <Volume2 class="size-4" />
      Master output
    </Card.Title>
    <Card.Description class="text-micro">
      The final gain applied after the background and soundboard lines are mixed. The transport dock
      carries the same control.
    </Card.Description>
  </Card.Header>
  <Card.Content class="flex items-center gap-3">
    <Slider
      id="settings-master-volume"
      bind:value={masterPercent}
      aria-label="Master output volume"
      onchange={change}
    />
    <span class="metric w-10 shrink-0 text-right">{masterPercent}%</span>
  </Card.Content>
</Card.Root>
```

- [ ] **Step 4: Create `src/lib/components/soundkeep/settings/bot-status-panel.svelte`**

```svelte
<script lang="ts">
  import { Bot } from '@lucide/svelte';
  import { Badge } from '$lib/components/ui/badge';
  import * as Card from '$lib/components/ui/card';
  import StatRow from '$lib/components/soundkeep/stat-row.svelte';
  import { useSoundkeep } from '$lib/soundkeep-client.svelte';

  const soundkeep = useSoundkeep();
</script>

<Card.Root class="min-w-0">
  <Card.Header class="pb-2">
    <Card.Title class="flex items-center gap-2 text-base">
      <Bot class="size-4" />
      Bot status
    </Card.Title>
    <Card.Description class="text-micro">Current Discord gateway and voice state.</Card.Description>
  </Card.Header>
  <Card.Content class="pb-3">
    <StatRow label="Configuration">
      <Badge variant={soundkeep.state.discord.configured ? 'success' : 'warning'}>
        {soundkeep.state.discord.configured ? 'Configured' : 'Missing token'}
      </Badge>
    </StatRow>
    <StatRow label="Gateway">
      <Badge variant={soundkeep.state.discord.ready ? 'success' : 'outline'}>
        {soundkeep.state.discord.ready ? 'Ready' : 'Offline'}
      </Badge>
    </StatRow>
    <StatRow label="Voice connection">
      <Badge variant={soundkeep.state.discord.connected ? 'success' : 'outline'}>
        {soundkeep.state.discord.connected ? 'Connected' : 'Disconnected'}
      </Badge>
    </StatRow>
    <StatRow label="Audio player">
      <Badge variant="secondary">{soundkeep.state.discord.playerState}</Badge>
    </StatRow>
    <StatRow label="Bot" value={soundkeep.state.discord.botName ?? 'Unknown'} />
  </Card.Content>
</Card.Root>
```

- [ ] **Step 5: Create `src/lib/components/soundkeep/settings/capabilities-panel.svelte`**

```svelte
<script lang="ts">
  import { CheckCircle2, CircleX, Server } from '@lucide/svelte';
  import { Badge } from '$lib/components/ui/badge';
  import * as Card from '$lib/components/ui/card';
  import StatRow from '$lib/components/soundkeep/stat-row.svelte';
  import { useSoundkeep } from '$lib/soundkeep-client.svelte';

  const soundkeep = useSoundkeep();

  let entries = $derived<Array<[string, boolean]>>([
    ['FFmpeg', soundkeep.state.capabilities.ffmpeg],
    ['FFprobe', soundkeep.state.capabilities.ffprobe]
  ]);
</script>

<Card.Root class="min-w-0">
  <Card.Header class="pb-2">
    <Card.Title class="flex items-center gap-2 text-base">
      <Server class="size-4" />
      Runtime capabilities
    </Card.Title>
    <Card.Description class="text-micro">
      External tools available in this deployment.
    </Card.Description>
  </Card.Header>
  <Card.Content class="pb-3">
    {#each entries as [label, available] (label)}
      <StatRow {label}>
        <Badge variant={available ? 'success' : 'warning'}>
          {#if available}<CheckCircle2 />{:else}<CircleX />{/if}
          {available ? 'Available' : 'Unavailable'}
        </Badge>
      </StatRow>
    {/each}
  </Card.Content>
</Card.Root>
```

- [ ] **Step 6: Create `src/lib/components/soundkeep/settings/diagnostics-panel.svelte`**

All 14 readouts from the current page are preserved.

```svelte
<script lang="ts">
  import { Cpu } from '@lucide/svelte';
  import * as Card from '$lib/components/ui/card';
  import StatRow from '$lib/components/soundkeep/stat-row.svelte';
  import { useSoundkeep } from '$lib/soundkeep-client.svelte';
  import { formatBytes } from '$lib/utils';

  const soundkeep = useSoundkeep();

  let diagnostics = $derived(soundkeep.state.discord.audioDiagnostics);
  let cache = $derived(soundkeep.state.pcmCache);

  function bitrateLabel(value: number | null, fallback: string) {
    return value === null ? fallback : `${Math.round(value / 1_000)} kbps`;
  }
</script>

<Card.Root class="min-w-0">
  <Card.Header class="pb-2">
    <Card.Title class="flex items-center gap-2 text-base">
      <Cpu class="size-4" />
      Audio diagnostics
    </Card.Title>
    <Card.Description class="text-micro">
      Low-level values reported by the active voice pipeline.
    </Card.Description>
  </Card.Header>
  <Card.Content class="grid gap-x-6 pb-3 md:grid-cols-2">
    <div>
      <StatRow label="Encoder" value={diagnostics.encoder} />
      <StatRow
        label="Configured bitrate"
        value={diagnostics.bitrateMode === 'auto'
          ? 'Auto'
          : `${Math.round(Number(diagnostics.bitrateMode) / 1_000)} kbps`}
      />
      <StatRow
        label="Discord channel limit"
        value={bitrateLabel(diagnostics.channelBitrate, 'Not connected')}
      />
      <StatRow
        label="Current output bitrate"
        value={bitrateLabel(diagnostics.bitrate, 'Inactive')}
      />
      <StatRow label="Packetization delay" value={`${diagnostics.packetizationMilliseconds} ms`} />
      <StatRow label="Missed frames" value={diagnostics.missedFrames} />
      <StatRow label="Discord filler frames" value={diagnostics.fillerFrames} />
    </div>
    <div>
      <StatRow label="Deferred partial frames" value={diagnostics.partialFramesDeferred} />
      <StatRow label="EOF frames padded" value={diagnostics.finalPartialFramesPadded} />
      <StatRow label="Stale frames dropped" value={diagnostics.staleFramesDropped} />
      <StatRow label="Cached effects" value={cache.entries} />
      <StatRow
        label="PCM cache"
        value={`${formatBytes(cache.bytes)} / ${formatBytes(cache.maxBytes)}`}
      />
      <StatRow label="Cache hits / misses" value={`${cache.hits} / ${cache.misses}`} />
      <StatRow
        label="Cache failures / evictions"
        value={`${cache.failures} / ${cache.evictions}`}
      />
    </div>
  </Card.Content>
</Card.Root>
```

- [ ] **Step 7: Rewrite `src/routes/settings/+page.svelte`**

Replace the entire file with:

```svelte
<script lang="ts">
  import { CircleX } from '@lucide/svelte';
  import * as Alert from '$lib/components/ui/alert';
  import BotStatusPanel from '$lib/components/soundkeep/settings/bot-status-panel.svelte';
  import CapabilitiesPanel from '$lib/components/soundkeep/settings/capabilities-panel.svelte';
  import DiagnosticsPanel from '$lib/components/soundkeep/settings/diagnostics-panel.svelte';
  import MasterOutputPanel from '$lib/components/soundkeep/settings/master-output-panel.svelte';
  import QualityPanel from '$lib/components/soundkeep/settings/quality-panel.svelte';
  import VoicePanel from '$lib/components/soundkeep/settings/voice-panel.svelte';
  import { useSoundkeep } from '$lib/soundkeep-client.svelte';

  const soundkeep = useSoundkeep();
</script>

<div class="flex min-w-0 flex-1 flex-col">
  <div class="bg-card/35 shrink-0 border-b px-3 py-2 md:px-4">
    <h1 class="font-display text-base font-semibold tracking-tight">Settings</h1>
    <p class="metric-label truncate">
      Configure the Discord destination and inspect the audio runtime.
    </p>
  </div>

  <div class="flex min-w-0 flex-1 flex-col gap-3 p-3 md:p-4">
    {#if soundkeep.state.discord.error}
      <Alert.Root variant="destructive">
        <CircleX />
        <Alert.Title>Discord connection error</Alert.Title>
        <Alert.Description>{soundkeep.state.discord.error}</Alert.Description>
      </Alert.Root>
    {/if}

    <div
      class="grid min-w-0 items-start gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]"
    >
      <div class="flex min-w-0 flex-col gap-3">
        <VoicePanel />
        <QualityPanel />
        <MasterOutputPanel />
      </div>
      <div class="flex min-w-0 flex-col gap-3">
        <BotStatusPanel />
        <CapabilitiesPanel />
      </div>
    </div>

    <DiagnosticsPanel />
  </div>
</div>
```

- [ ] **Step 8: Verify the settings page**

Run: `npm run format && npm run lint && npm run check && npm run build && npm run test:run`
Expected: all succeed.

- [ ] **Step 9: Commit**

```bash
git add src/lib/components/soundkeep/settings src/routes/settings/+page.svelte
git commit -m "feat(ui): rebuild settings as dense stat panels"
```

---

### Task 8: End-to-end verification and feature parity pass

**Files:**

- Modify: `tests/e2e/dashboard.test.ts`

**Interfaces:**

- Consumes: everything from Tasks 1-7.
- Produces: a passing end-to-end suite and a confirmed parity checklist.

- [ ] **Step 1: Run the existing end-to-end suite unchanged and record every failure**

Run: `npm run test:e2e`
Expected: the suite may fail. Write down each failing assertion with its line number before changing anything. Do not edit the test until you have the full list.

- [ ] **Step 2: Apply only these two intentional test updates**

The `Background music` heading moved from the console's player card into the dock, which is rendered by the layout. It is still present on `/`, so line 21 needs no change. Two assertions do need updating.

First, the old design had a `Session output` card with a `Master volume` field on the console; the new console `Output` card no longer contains a slider. No assertion covers this, so no edit is needed there.

Second, the settings assertion on line 77 uses `page.getByText('Master output')`. The new settings page renders `Master output` as a `Card.Title` (`<h3>`). Change it to assert the heading explicitly:

```ts
await expect(page.getByRole('heading', { name: 'Master output' })).toBeVisible();
```

Third, the console assertion on line 21 relies on `Background music` being a heading. Confirm the dock renders `<h2 class="sr-only">Background music</h2>` — if `getByRole('heading', { name: 'Background music' })` fails because the dock is off-screen at the bottom, change that single assertion to:

```ts
await expect(page.getByRole('heading', { name: 'Background music' })).toBeAttached();
```

Make no other edits to the test file. If some other assertion fails, fix the application code, not the test.

- [ ] **Step 3: Re-run the end-to-end suite**

Run: `npm run test:e2e`
Expected: PASS, 1 test.

- [ ] **Step 4: Run the complete verification gate**

Run: `npm run format && npm run lint && npm run check && npm run test:run && npm run build && npm run test:e2e && npm run helm:lint`
Expected: every command succeeds.

- [ ] **Step 5: Walk the feature parity checklist**

Start the dev server with `npm run dev` and confirm each of the 27 numbered items in the "Feature parity checklist" section of `docs/superpowers/specs/2026-07-29-soundkeep-dense-dashboard-design.md`. Items 1-6 that need a live Discord token can be confirmed by inspection of the rendered controls and their disabled states when no token is configured. Record any item that cannot be confirmed.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/dashboard.test.ts
git commit -m "test: align end-to-end assertions with the dense dashboard"
```

---

## Self-Review

**Spec coverage:**

| Spec section                                                                                       | Task |
| -------------------------------------------------------------------------------------------------- | ---- |
| Density scale (tokens, radius, `.metric`, card padding)                                            | 1    |
| Shared primitives (`StatRow`, `AssetIconGlyph`, icon-map dedup)                                    | 2    |
| Playback position extraction                                                                       | 3    |
| Transport dock, compact header, `data-app-shell`, `--titlebar-height`, master volume out of header | 4    |
| Console three-column layout, scenes, queue, soundboard, output, activity, scene dialogs            | 5    |
| Library dense rows, inline upload, storage panel, asset dialogs                                    | 6    |
| Settings panels, `StatRow` diagnostics, master output kept on the page                             | 7    |
| Verification gate, preserved selectors, parity checklist                                           | 8    |

Every feature-parity item maps to a task: 1-2 → Task 7 `VoicePanel`; 2 → Task 7 `QualityPanel`; 3 → Task 7 `BotStatusPanel`; 4 → Task 7 `CapabilitiesPanel`; 5 → Task 7 `DiagnosticsPanel`; 6 → Tasks 5 (`OutputPanel`) and 7; 7-11 → Task 4 `TransportDock`; 12 → Task 5 `SoundboardGrid`; 13-14 → Task 5 scene components; 15-22 → Task 6; 23 → Task 6 `StoragePanel`; 24-27 → Task 4 layout, unchanged shell behaviour.

**Placeholder scan:** no "TBD", no "handle edge cases", no "similar to Task N". Every code step contains complete file contents or an explicit enumerated edit list.

**Type consistency:** `PlaybackObservation` has exactly the fields `positionMilliseconds` and `observedAtMilliseconds` in Task 3 and is used with those names in Task 4. `interpolatePlaybackPosition` takes `{ observation, playing, nowMilliseconds, durationMilliseconds, repeat }` in both. `StatRow` props `{ label, value, class, children }` from Task 2 match every call site in Tasks 5-7. `AssetIconGlyph` props `{ icon, class }` match its use in Tasks 5-6. Component prop names `onedit` / `ondelete` / `oncreate` / `onclose` / `asset` / `scene` / `open` are consistent between each component's definition and its call site in the rewritten pages.

**One deviation from the spec, recorded deliberately:** the spec listed `playback-position.svelte.ts` under `src/lib/components/soundkeep/`. The plan puts it at `src/lib/playback-position.ts` — it is a pure module with no runes, Vitest runs in a `node` environment without a DOM, and it does not belong in a components directory. Behaviour is identical.
