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
  import { formatDuration } from '$lib/utils';

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
      <span class="metric-label w-7 shrink-0 text-right tabular-nums">{masterPercent}</span>
    </div>
  </div>
</section>
