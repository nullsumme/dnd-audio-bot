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
  <Card.Header class="shrink-0 flex-row items-start justify-between gap-3 pb-2">
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
          <Button href="/library" variant="outline" size="sm">
            <FolderOpen data-icon="inline-start" />
            Open library
          </Button>
        </Empty.Content>
      </Empty.Root>
    {:else}
      <Tabs.Root bind:value={selectedCategory} class="flex min-h-0 min-w-0 flex-1 flex-col">
        <div class="w-full min-w-0 shrink-0 overflow-x-auto pb-1">
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
          <Tabs.Content
            value={selectedCategory}
            class="min-h-0 min-w-0 flex-1 overflow-y-auto pt-2.5 pr-1"
          >
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
