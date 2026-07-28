<script lang="ts">
  import { onMount } from 'svelte';
  import {
    Activity,
    AudioLines,
    Bell,
    CircleStop,
    CloudLightning,
    DoorOpen,
    Flame,
    FolderOpen,
    Gauge,
    Headphones,
    Layers3,
    ListMusic,
    Music2,
    Pause,
    Pencil,
    Play,
    Plus,
    Radio,
    Repeat,
    Repeat1,
    Shuffle,
    Skull,
    Sparkles,
    Swords,
    Trash2,
    Users,
    Volume2,
    WandSparkles,
    Waves,
    Wind,
    Zap,
    SkipBack,
    SkipForward
  } from '@lucide/svelte';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import * as Avatar from '$lib/components/ui/avatar';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Empty from '$lib/components/ui/empty';
  import * as Field from '$lib/components/ui/field';
  import { Input } from '$lib/components/ui/input';
  import * as ScrollArea from '$lib/components/ui/scroll-area';
  import * as Select from '$lib/components/ui/select';
  import { Separator } from '$lib/components/ui/separator';
  import { Slider } from '$lib/components/ui/slider';
  import { Spinner } from '$lib/components/ui/spinner';
  import * as Tabs from '$lib/components/ui/tabs';
  import { Textarea } from '$lib/components/ui/textarea';
  import type { AssetIcon } from '$lib/asset-metadata';
  import { useSoundkeep } from '$lib/soundkeep-client.svelte';
  import type { AudioAsset, SceneCollection } from '$lib/types';
  import { cn, formatDuration } from '$lib/utils';

  const soundkeep = useSoundkeep();
  const iconByName = {
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

  let selectedCategory = $state('all');
  let selectedBackground = $state('');
  let masterPercent = $state(Math.round(soundkeep.state.masterVolume * 100));
  let clock = $state(Date.now());
  let observedSourceId = $state('');
  let observedPosition = $state(0);
  let observedAt = $state(Date.now());

  let sceneDialogOpen = $state(false);
  let editingScene = $state<SceneCollection | null>(null);
  let sceneName = $state('');
  let sceneDescription = $state('');
  let sceneTrackIds = $state<string[]>([]);
  let sceneEffectIds = $state<string[]>([]);
  let deletingScene = $state<SceneCollection | null>(null);

  let soundboardCategories = $derived(
    [...new Set(soundkeep.visibleSoundboardAssets.map((asset) => asset.category))].sort(
      (left, right) => left.localeCompare(right)
    )
  );
  let visibleSoundboardAssets = $derived(
    selectedCategory === 'all'
      ? soundkeep.visibleSoundboardAssets
      : soundkeep.visibleSoundboardAssets.filter((asset) => asset.category === selectedCategory)
  );
  let currentBackgroundAsset = $derived(
    soundkeep.state.assets.find((asset) => asset.id === soundkeep.backgroundSource?.assetId) ?? null
  );
  let playbackDuration = $derived(
    Math.max(
      0,
      Math.round(
        (soundkeep.backgroundSource?.duration ?? currentBackgroundAsset?.duration ?? 0) * 1_000
      )
    )
  );
  let playbackPosition = $derived.by(() => {
    const source = soundkeep.backgroundSource;
    if (!source) return 0;
    let position = observedPosition;
    if (source.state === 'playing') position += Math.max(0, clock - observedAt);
    if (playbackDuration <= 0) return Math.max(0, position);
    return source.repeat
      ? Math.max(0, position % playbackDuration)
      : Math.min(playbackDuration, Math.max(0, position));
  });

  onMount(() => {
    const interval = window.setInterval(() => {
      clock = Date.now();
    }, 250);
    return () => window.clearInterval(interval);
  });

  $effect(() => {
    const source = soundkeep.backgroundSource;
    const sourceId = source?.id ?? '';
    const position = source?.positionMilliseconds ?? 0;
    const state = source?.state;
    sourceId;
    position;
    state;
    observedSourceId = sourceId;
    observedPosition = position;
    observedAt = Date.now();
  });

  $effect(() => {
    const candidates = soundkeep.visibleBackgroundAssets;
    if (!selectedBackground || !candidates.some((asset) => asset.id === selectedBackground)) {
      selectedBackground =
        candidates.find((asset) => asset.id === soundkeep.backgroundSource?.assetId)?.id ??
        candidates[0]?.id ??
        '';
    }
  });

  $effect(() => {
    if (
      selectedCategory !== 'all' &&
      !soundboardCategories.some((category) => category === selectedCategory)
    ) {
      selectedCategory = 'all';
    }
  });

  $effect(() => {
    masterPercent = Math.round(soundkeep.state.masterVolume * 100);
  });

  function openSceneDialog(scene: SceneCollection | null = null) {
    editingScene = scene;
    sceneName = scene?.name ?? '';
    sceneDescription = scene?.description ?? '';
    sceneTrackIds = [...(scene?.trackIds ?? [])];
    sceneEffectIds = [...(scene?.effectIds ?? [])];
    sceneDialogOpen = true;
  }

  function assignSceneAsset(kind: 'track' | 'effect', id: string, checked: boolean) {
    const current = kind === 'track' ? sceneTrackIds : sceneEffectIds;
    const next = checked
      ? current.includes(id)
        ? current
        : [...current, id]
      : current.filter((candidate) => candidate !== id);
    if (kind === 'track') sceneTrackIds = next;
    else sceneEffectIds = next;
  }

  async function saveScene() {
    const input = {
      name: sceneName,
      description: sceneDescription,
      trackIds: sceneTrackIds,
      effectIds: sceneEffectIds
    };
    const saved = editingScene
      ? await soundkeep.updateScene(editingScene, input)
      : await soundkeep.createScene(input);
    if (saved) sceneDialogOpen = false;
  }

  async function confirmSceneDelete() {
    if (!deletingScene) return;
    const deleted = await soundkeep.deleteScene(deletingScene);
    if (deleted) deletingScene = null;
  }

  async function playSelectedBackground() {
    const asset = soundkeep.state.assets.find((item) => item.id === selectedBackground);
    if (asset) await soundkeep.playAsset(asset, 'ambience');
  }

  async function playBackground(asset: AudioAsset) {
    selectedBackground = asset.id;
    await soundkeep.playAsset(asset, 'ambience');
  }

  async function seekBackground(event: Event) {
    const source = soundkeep.backgroundSource;
    if (!source) return;
    const positionMilliseconds = Number((event.currentTarget as HTMLInputElement).value);
    observedPosition = positionMilliseconds;
    observedAt = Date.now();
    await soundkeep.changeSourceTransport(source.id, { positionMilliseconds });
  }

  async function changeMasterVolume(event: Event) {
    masterPercent = Number((event.currentTarget as HTMLInputElement).value);
    await soundkeep.changeMasterVolume(masterPercent / 100);
  }

  function currentBitrateLabel() {
    const diagnostics = soundkeep.state.discord.audioDiagnostics;
    if (diagnostics.bitrate !== null) return `${Math.round(diagnostics.bitrate / 1_000)} kbps`;
    if (diagnostics.bitrateMode === 'auto') return 'Auto';
    return `${Math.round(Number(diagnostics.bitrateMode) / 1_000)} kbps target`;
  }

  function repeatLabel() {
    if (soundkeep.state.playback.repeatMode === 'one') return 'Repeat one';
    if (soundkeep.state.playback.repeatMode === 'all') return 'Repeat all';
    return 'Repeat off';
  }

  function cycleRepeat() {
    const current = soundkeep.state.playback.repeatMode;
    const repeatMode = current === 'off' ? 'all' : current === 'all' ? 'one' : 'off';
    return soundkeep.configurePlayback({ repeatMode });
  }

  function activityTime(timestamp: string) {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(timestamp));
  }
</script>

<div class="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-y-auto xl:overflow-hidden">
  <div
    class="bg-card/35 flex shrink-0 flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between md:px-6"
  >
    <div class="min-w-0">
      <h1 class="font-display text-xl font-semibold tracking-tight">Session console</h1>
      <p class="text-muted-foreground truncate text-xs">
        Scenes, effects, transport, and Discord output in one live control surface.
      </p>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <Badge variant="outline">
        <Layers3 />
        {soundkeep.activeScene?.name ?? 'All sounds'}
      </Badge>
      <Badge variant="outline">{soundkeep.visibleSoundboardAssets.length} effects</Badge>
      <Button href="/library" variant="outline" size="sm">
        <Plus data-icon="inline-start" />
        Add MP3
      </Button>
    </div>
  </div>

  <div
    class="grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-4 p-4 md:p-5 xl:grid-cols-[13rem_minmax(0,1fr)_22rem] xl:overflow-hidden"
  >
    <Card.Root class="min-w-0 shrink-0 xl:min-h-0 xl:overflow-hidden">
      <Card.Header class="pb-2">
        <div class="flex items-center justify-between gap-2">
          <div>
            <Card.Title class="flex items-center gap-2 text-base">
              <Layers3 />
              Scenes
            </Card.Title>
            <Card.Description>Session presets</Card.Description>
          </div>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Create scene"
            onclick={() => openSceneDialog()}
          >
            <Plus />
          </Button>
        </div>
      </Card.Header>
      <Card.Content class="flex min-h-0 flex-col gap-3 px-3 pb-3">
        <ScrollArea.Root class="max-h-48 min-h-0 xl:max-h-none xl:flex-1">
          <div class="flex gap-1 pr-2 xl:flex-col">
            <button
              type="button"
              class={cn(
                'hover:bg-muted flex min-w-36 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors xl:min-w-0',
                soundkeep.state.playback.activeSceneId === null && 'bg-primary/10 text-primary'
              )}
              aria-pressed={soundkeep.state.playback.activeSceneId === null}
              onclick={() => soundkeep.setActiveScene(null)}
            >
              <span class="bg-muted grid size-8 shrink-0 place-items-center rounded-md">
                <AudioLines class="size-4" />
              </span>
              <span class="min-w-0 flex-1">
                <span class="block truncate font-medium">All sounds</span>
                <span class="text-muted-foreground block text-[11px]"> Full library </span>
              </span>
            </button>
            {#each soundkeep.state.scenes as scene (scene.id)}
              {@const active = scene.id === soundkeep.state.playback.activeSceneId}
              <button
                type="button"
                class={cn(
                  'hover:bg-muted group flex min-w-36 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors xl:min-w-0',
                  active && 'bg-primary/10 text-primary'
                )}
                aria-pressed={active}
                onclick={() => soundkeep.setActiveScene(scene.id)}
              >
                <span
                  class={cn(
                    'grid size-8 shrink-0 place-items-center rounded-md',
                    active ? 'bg-primary/20' : 'bg-muted text-muted-foreground'
                  )}
                >
                  <Layers3 class="size-4" />
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate font-medium">{scene.name}</span>
                  <span class="text-muted-foreground block text-[11px]">
                    {scene.trackIds.length + scene.effectIds.length} sounds
                  </span>
                </span>
              </button>
            {/each}
          </div>
        </ScrollArea.Root>

        <Separator />
        <div class="grid grid-cols-2 gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={!soundkeep.activeScene}
            onclick={() => openSceneDialog(soundkeep.activeScene)}
          >
            <Pencil data-icon="inline-start" />
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            class="text-destructive"
            disabled={!soundkeep.activeScene}
            onclick={() => (deletingScene = soundkeep.activeScene)}
          >
            <Trash2 data-icon="inline-start" />
            Delete
          </Button>
        </div>
      </Card.Content>
    </Card.Root>

    <Card.Root class="flex min-h-[30rem] min-w-0 flex-col xl:min-h-0 xl:overflow-hidden">
      <Card.Header class="shrink-0">
        <div class="flex items-start justify-between gap-4">
          <div>
            <Card.Title class="flex items-center gap-2">
              <WandSparkles />
              Soundboard
            </Card.Title>
            <Card.Description>
              Trigger one-shot effects without interrupting the background line.
            </Card.Description>
          </div>
          <div class="flex items-center gap-2">
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
        </div>
      </Card.Header>

      <Card.Content class="flex min-h-0 min-w-0 flex-1 flex-col">
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
              <Button href="/library" variant="outline">
                <FolderOpen data-icon="inline-start" />
                Open library
              </Button>
            </Empty.Content>
          </Empty.Root>
        {:else}
          <Tabs.Root bind:value={selectedCategory} class="min-h-0 min-w-0 flex-1">
            <div class="w-full min-w-0 shrink-0 overflow-x-auto pb-1">
              <Tabs.List variant="line">
                <Tabs.Trigger value="all">
                  All sounds
                  <Badge variant="outline">{soundkeep.visibleSoundboardAssets.length}</Badge>
                </Tabs.Trigger>
                {#each soundboardCategories as category (category)}
                  <Tabs.Trigger value={category}>
                    {category}
                    <Badge variant="outline">
                      {soundkeep.visibleSoundboardAssets.filter(
                        (asset) => asset.category === category
                      ).length}
                    </Badge>
                  </Tabs.Trigger>
                {/each}
              </Tabs.List>
            </div>

            {#key selectedCategory}
              <Tabs.Content
                value={selectedCategory}
                class="min-h-0 min-w-0 overflow-y-auto pt-3 pr-1 pb-1"
              >
                <div class="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
                  {#each visibleSoundboardAssets as asset (asset.id)}
                    {@const Icon = iconByName[asset.icon]}
                    {@const active = soundkeep.soundboardSource?.assetId === asset.id}
                    <button
                      type="button"
                      aria-label={`Play ${asset.name}`}
                      aria-pressed={active}
                      class={cn(
                        'group focus-visible:ring-ring/50 hover:bg-muted relative flex aspect-square min-h-24 flex-col items-center justify-center gap-2 rounded-xl border p-3 text-center transition-all outline-none hover:-translate-y-0.5 focus-visible:ring-3 active:translate-y-0 disabled:pointer-events-none disabled:opacity-45',
                        active
                          ? 'border-primary/60 bg-primary/10 shadow-[0_16px_36px_-26px_var(--primary)]'
                          : 'border-border/80 bg-secondary/30 hover:border-primary/35'
                      )}
                      disabled={!soundkeep.state.discord.connected || soundkeep.busy !== null}
                      onclick={() => soundkeep.playAsset(asset, 'soundboard')}
                    >
                      <span
                        class={cn(
                          'grid size-10 place-items-center rounded-lg transition-transform group-hover:scale-105',
                          active ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
                        )}
                      >
                        {#if soundkeep.busy === `play-soundboard-${asset.id}`}
                          <Spinner />
                        {:else}
                          <Icon class="size-5" />
                        {/if}
                      </span>
                      <span class="line-clamp-2 text-sm leading-tight font-semibold">
                        {asset.name}
                      </span>
                      <span class="text-muted-foreground max-w-full truncate text-[11px]">
                        {asset.subtitle || asset.mood || asset.category}
                      </span>
                      {#if active}
                        <span
                          class="ring-primary/45 pointer-events-none absolute inset-0 rounded-xl ring-2"
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

    <aside
      class="flex min-h-0 min-w-0 flex-col gap-4 xl:overflow-y-auto"
      aria-label="Playback controls"
    >
      <Card.Root class="min-w-0 shrink-0 overflow-hidden">
        <h2 class="sr-only">Background music</h2>
        <div
          class="from-primary/15 via-muted to-card relative grid aspect-[16/8] place-items-center overflow-hidden border-b bg-linear-to-br"
        >
          {#if currentBackgroundAsset?.artworkFilename}
            <img
              src={`/api/library/${currentBackgroundAsset.id}/artwork?v=${encodeURIComponent(currentBackgroundAsset.updatedAt)}`}
              alt=""
              class="absolute inset-0 size-full object-cover opacity-55"
            />
            <div
              class="absolute inset-0 bg-linear-to-t from-black/75 via-black/20 to-transparent"
            ></div>
          {:else}
            <div class="bg-background/50 grid size-16 place-items-center rounded-full border">
              <Music2 class="text-primary size-8" />
            </div>
          {/if}
          {#if soundkeep.backgroundSource?.state === 'playing'}
            <div class="absolute bottom-4 left-4 flex h-6 items-end gap-1" aria-hidden="true">
              <span class="meter-bar bg-primary h-3 w-1 rounded-full"></span>
              <span class="meter-bar bg-primary h-5 w-1 rounded-full"></span>
              <span class="meter-bar bg-primary h-4 w-1 rounded-full"></span>
            </div>
          {/if}
          <Badge variant="outline" class="bg-background/70 absolute top-3 right-3">
            {repeatLabel()}
          </Badge>
        </div>

        <Card.Header class="pb-3">
          <div class="min-w-0 text-center">
            <p class="text-primary text-xs font-semibold tracking-widest uppercase">
              {currentBackgroundAsset?.mood ||
                currentBackgroundAsset?.category ||
                soundkeep.activeScene?.name ||
                'Background'}
            </p>
            <Card.Title class="mt-1 truncate text-xl">
              {soundkeep.backgroundSource?.label ?? 'Nothing playing'}
            </Card.Title>
            <Card.Description class="mt-1 truncate">
              {currentBackgroundAsset?.subtitle ||
                (soundkeep.backgroundSource
                  ? 'Streaming to Discord'
                  : 'Choose a track from the queue')}
            </Card.Description>
          </div>
        </Card.Header>

        <Card.Content class="flex flex-col gap-4">
          <div>
            <Slider
              value={Math.round(playbackPosition)}
              min={0}
              max={Math.max(playbackDuration, 1)}
              step={250}
              disabled={!soundkeep.backgroundSource || playbackDuration === 0}
              aria-label="Background playback position"
              onchange={seekBackground}
            />
            <div class="text-muted-foreground mt-1 flex justify-between text-[11px] tabular-nums">
              <span>{formatDuration(playbackPosition / 1_000)}</span>
              <span>{formatDuration(playbackDuration / 1_000)}</span>
            </div>
          </div>

          <div class="flex items-center justify-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Toggle shuffle"
              class={soundkeep.state.playback.shuffle ? 'text-primary' : undefined}
              onclick={() =>
                soundkeep.configurePlayback({ shuffle: !soundkeep.state.playback.shuffle })}
            >
              <Shuffle />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Previous background track"
              disabled={soundkeep.visibleBackgroundAssets.length === 0}
              onclick={() => soundkeep.previousTrack()}
            >
              <SkipBack />
            </Button>
            <Button
              size="icon-lg"
              aria-label={soundkeep.backgroundSource?.state === 'paused'
                ? 'Resume background'
                : soundkeep.backgroundSource
                  ? 'Pause background'
                  : 'Play selected background'}
              disabled={(!soundkeep.backgroundSource && !selectedBackground) ||
                !soundkeep.state.discord.connected}
              onclick={() =>
                soundkeep.backgroundSource
                  ? soundkeep.changeSourceTransport(soundkeep.backgroundSource.id, {
                      paused: soundkeep.backgroundSource.state !== 'paused'
                    })
                  : playSelectedBackground()}
            >
              {#if soundkeep.busy?.startsWith('transport-') || soundkeep.busy?.startsWith('play-ambience')}
                <Spinner />
              {:else if soundkeep.backgroundSource?.state === 'paused'}
                <Play />
              {:else if soundkeep.backgroundSource}
                <Pause />
              {:else}
                <Play />
              {/if}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Next background track"
              disabled={soundkeep.visibleBackgroundAssets.length === 0}
              onclick={() => soundkeep.nextTrack()}
            >
              <SkipForward />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={repeatLabel()}
              class={soundkeep.state.playback.repeatMode !== 'off' ? 'text-primary' : undefined}
              onclick={cycleRepeat}
            >
              {#if soundkeep.state.playback.repeatMode === 'one'}<Repeat1 />{:else}<Repeat />{/if}
            </Button>
          </div>

          <Field.Field>
            <Field.Label for="background-select" class="sr-only">Background track</Field.Label>
            <div class="flex gap-2">
              <Select.Root type="single" bind:value={selectedBackground}>
                <Select.Trigger
                  id="background-select"
                  class="min-w-0 flex-1"
                  aria-label="Library selection"
                >
                  <span class="truncate">
                    {soundkeep.state.assets.find((asset) => asset.id === selectedBackground)
                      ?.name ?? 'Choose a track'}
                  </span>
                </Select.Trigger>
                <Select.Content>
                  <Select.Group>
                    <Select.Label
                      >{soundkeep.activeScene?.name ?? 'Background library'}</Select.Label
                    >
                    {#each soundkeep.visibleBackgroundAssets as asset (asset.id)}
                      <Select.Item value={asset.id}>{asset.name}</Select.Item>
                    {/each}
                  </Select.Group>
                </Select.Content>
              </Select.Root>
              <Button
                size="icon"
                variant="outline"
                aria-label="Play selected background"
                disabled={!selectedBackground || !soundkeep.state.discord.connected}
                onclick={playSelectedBackground}
              >
                <Play />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Stop background"
                disabled={!soundkeep.backgroundSource}
                onclick={() => soundkeep.stopScope('ambience')}
              >
                <CircleStop />
              </Button>
            </div>
          </Field.Field>

          {#if soundkeep.backgroundSource}
            <Field.Field>
              <div class="flex items-center justify-between gap-3">
                <Field.Label for="background-volume">Background volume</Field.Label>
                <span class="text-muted-foreground text-xs tabular-nums">
                  {Math.round(soundkeep.backgroundSource.volume * 100)}%
                </span>
              </div>
              <div class="flex items-center gap-3">
                <Volume2 class="text-muted-foreground size-4" />
                <Slider
                  id="background-volume"
                  value={Math.round(soundkeep.backgroundSource.volume * 100)}
                  aria-label={`Volume for ${soundkeep.backgroundSource.label}`}
                  onchange={(event) =>
                    soundkeep.changeSourceVolume(
                      soundkeep.backgroundSource!.id,
                      Number((event.currentTarget as HTMLInputElement).value) / 100
                    )}
                />
              </div>
            </Field.Field>
          {/if}

          <Separator />
          <section class="flex flex-col gap-2" aria-labelledby="music-queue-heading">
            <div class="flex items-center justify-between gap-3">
              <h3
                id="music-queue-heading"
                class="font-display text-sm font-semibold tracking-wider uppercase"
              >
                Queue
              </h3>
              <Badge variant="outline">{soundkeep.visibleBackgroundAssets.length}</Badge>
            </div>
            {#if soundkeep.visibleBackgroundAssets.length === 0}
              <p
                class="text-muted-foreground rounded-lg border border-dashed p-4 text-center text-xs"
              >
                No background tracks in this scene.
              </p>
            {:else}
              <ScrollArea.Root class="h-44">
                <div class="flex flex-col gap-1 pr-2">
                  {#each soundkeep.visibleBackgroundAssets as asset (asset.id)}
                    {@const active = soundkeep.backgroundSource?.assetId === asset.id}
                    <button
                      type="button"
                      class={cn(
                        'hover:bg-muted flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors disabled:opacity-45',
                        active && 'bg-primary/10'
                      )}
                      aria-label={`Play background ${asset.name}`}
                      aria-current={active ? 'true' : undefined}
                      disabled={!soundkeep.state.discord.connected}
                      onclick={() => playBackground(asset)}
                    >
                      <Avatar.Root size="lg" class="rounded-lg after:rounded-lg">
                        {#if asset.artworkFilename}
                          <Avatar.Image
                            src={`/api/library/${asset.id}/artwork?v=${encodeURIComponent(asset.updatedAt)}`}
                            alt=""
                            class="rounded-lg"
                          />
                        {/if}
                        <Avatar.Fallback class="rounded-lg">
                          <Music2 class="size-4" />
                        </Avatar.Fallback>
                      </Avatar.Root>
                      <span class="min-w-0 flex-1">
                        <span class="block truncate text-sm font-medium">{asset.name}</span>
                        <span class="text-muted-foreground block truncate text-xs">
                          {asset.subtitle || asset.category}
                        </span>
                      </span>
                      <span class="text-muted-foreground shrink-0 text-xs tabular-nums">
                        {formatDuration(asset.duration)}
                      </span>
                    </button>
                  {/each}
                </div>
              </ScrollArea.Root>
            {/if}
          </section>
        </Card.Content>
      </Card.Root>

      <Card.Root class="min-w-0 shrink-0">
        <Card.Header class="pb-3">
          <div class="flex items-center justify-between gap-3">
            <div>
              <Card.Title class="flex items-center gap-2 text-base">
                <Gauge />
                Session output
              </Card.Title>
              <Card.Description>The live Discord mix</Card.Description>
            </div>
            <Badge variant={soundkeep.state.discord.connected ? 'success' : 'outline'}>
              <Radio />
              {soundkeep.state.discord.connected ? 'Live' : 'Offline'}
            </Badge>
          </div>
        </Card.Header>
        <Card.Content class="flex flex-col gap-3">
          <Field.Field class="2xl:hidden">
            <div class="flex items-center justify-between gap-3">
              <Field.Label for="console-master-volume">Master volume</Field.Label>
              <span class="text-muted-foreground text-xs tabular-nums">{masterPercent}%</span>
            </div>
            <Slider
              id="console-master-volume"
              bind:value={masterPercent}
              aria-label="Master volume"
              onchange={changeMasterVolume}
            />
          </Field.Field>
          <div class="grid grid-cols-2 gap-2">
            <div class="bg-muted/45 rounded-lg border p-2.5">
              <p class="text-muted-foreground flex items-center gap-1.5 text-[11px]">
                <Users class="size-3" />
                Listeners
              </p>
              <p class="mt-1 text-lg font-semibold tabular-nums">
                {soundkeep.state.discord.listenerCount}
              </p>
            </div>
            <div class="bg-muted/45 rounded-lg border p-2.5">
              <p class="text-muted-foreground flex items-center gap-1.5 text-[11px]">
                <Headphones class="size-3" />
                Bitrate
              </p>
              <p class="mt-1 text-sm font-semibold">{currentBitrateLabel()}</p>
            </div>
          </div>
          <Button
            variant="destructive"
            disabled={!soundkeep.backgroundSource && !soundkeep.soundboardSource}
            onclick={() => soundkeep.stopScope('all')}
          >
            <CircleStop data-icon="inline-start" />
            Stop all audio
          </Button>
        </Card.Content>
      </Card.Root>

      <Card.Root class="min-w-0 shrink-0">
        <Card.Header class="pb-2">
          <Card.Title class="flex items-center gap-2 text-base">
            <Activity />
            Recent activity
          </Card.Title>
          <Card.Description>Server events shared by every dashboard</Card.Description>
        </Card.Header>
        <Card.Content>
          {#if soundkeep.state.activity.length === 0}
            <p class="text-muted-foreground py-3 text-center text-xs">No session activity yet.</p>
          {:else}
            <ScrollArea.Root class="h-40">
              <div class="flex flex-col pr-3">
                {#each soundkeep.state.activity as entry, index (entry.id)}
                  <div class="flex gap-2 py-2">
                    <span
                      class="bg-muted text-muted-foreground grid size-7 shrink-0 place-items-center rounded-full"
                    >
                      {#if entry.category === 'discord'}
                        <Radio class="size-3.5" />
                      {:else if entry.category === 'scene'}
                        <Layers3 class="size-3.5" />
                      {:else if entry.category === 'library'}
                        <ListMusic class="size-3.5" />
                      {:else}
                        <AudioLines class="size-3.5" />
                      {/if}
                    </span>
                    <span class="min-w-0 flex-1">
                      <span class="block text-xs leading-snug">{entry.message}</span>
                      <span class="text-muted-foreground text-[10px]"
                        >{activityTime(entry.createdAt)}</span
                      >
                    </span>
                  </div>
                  {#if index < soundkeep.state.activity.length - 1}<Separator />{/if}
                {/each}
              </div>
            </ScrollArea.Root>
          {/if}
        </Card.Content>
      </Card.Root>
    </aside>
  </div>
</div>

<Dialog.Root bind:open={sceneDialogOpen}>
  <Dialog.Content class="sm:max-w-3xl">
    <Dialog.Header>
      <Dialog.Title>{editingScene ? 'Edit scene' : 'Create scene'}</Dialog.Title>
      <Dialog.Description>
        Bundle background tracks and sound effects into a reusable tabletop preset.
      </Dialog.Description>
    </Dialog.Header>

    <Field.Group>
      <div class="grid gap-4 sm:grid-cols-2">
        <Field.Field>
          <Field.Label for="scene-name">Name</Field.Label>
          <Input
            id="scene-name"
            bind:value={sceneName}
            maxlength={100}
            placeholder="Haunted crypt"
          />
        </Field.Field>
        <Field.Field>
          <Field.Label for="scene-description">Description</Field.Label>
          <Textarea
            id="scene-description"
            bind:value={sceneDescription}
            maxlength={500}
            rows={2}
            placeholder="The party descends below the chapel…"
          />
        </Field.Field>
      </div>

      <div class="grid min-h-0 gap-4 sm:grid-cols-2">
        <Field.Set>
          <Field.Legend variant="label">Background tracks</Field.Legend>
          <Field.Description>{sceneTrackIds.length} selected</Field.Description>
          <ScrollArea.Root class="mt-2 h-52 rounded-lg border">
            <Field.Group class="gap-1 p-2">
              {#each soundkeep.backgroundAssets as asset (asset.id)}
                <Field.Label class="hover:bg-muted rounded-lg">
                  <Field.Field orientation="horizontal">
                    <Checkbox
                      checked={sceneTrackIds.includes(asset.id)}
                      onCheckedChange={(checked: boolean) =>
                        assignSceneAsset('track', asset.id, checked)}
                    />
                    <Field.Content>
                      <Field.Title>{asset.name}</Field.Title>
                      <Field.Description>{asset.category}</Field.Description>
                    </Field.Content>
                  </Field.Field>
                </Field.Label>
              {:else}
                <p class="text-muted-foreground p-3 text-center text-xs">No background MP3s.</p>
              {/each}
            </Field.Group>
          </ScrollArea.Root>
        </Field.Set>

        <Field.Set>
          <Field.Legend variant="label">Sound effects</Field.Legend>
          <Field.Description>{sceneEffectIds.length} selected</Field.Description>
          <ScrollArea.Root class="mt-2 h-52 rounded-lg border">
            <Field.Group class="gap-1 p-2">
              {#each soundkeep.soundboardAssets as asset (asset.id)}
                <Field.Label class="hover:bg-muted rounded-lg">
                  <Field.Field orientation="horizontal">
                    <Checkbox
                      checked={sceneEffectIds.includes(asset.id)}
                      onCheckedChange={(checked: boolean) =>
                        assignSceneAsset('effect', asset.id, checked)}
                    />
                    <Field.Content>
                      <Field.Title>{asset.name}</Field.Title>
                      <Field.Description>{asset.category}</Field.Description>
                    </Field.Content>
                  </Field.Field>
                </Field.Label>
              {:else}
                <p class="text-muted-foreground p-3 text-center text-xs">No soundboard MP3s.</p>
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
        disabled={!sceneName.trim() ||
          sceneTrackIds.length + sceneEffectIds.length === 0 ||
          soundkeep.busy !== null}
        onclick={saveScene}
      >
        {#if soundkeep.busy === 'create-scene' || soundkeep.busy?.startsWith('edit-scene-')}
          <Spinner data-icon="inline-start" />
        {/if}
        {editingScene ? 'Save scene' : 'Create scene'}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<AlertDialog.Root
  open={deletingScene !== null}
  onOpenChange={(open) => !open && (deletingScene = null)}
>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Delete {deletingScene?.name}?</AlertDialog.Title>
      <AlertDialog.Description>
        The scene preset will be removed. Its MP3 files stay in the Library.
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action variant="destructive" onclick={confirmSceneDelete}>
        Delete scene
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
