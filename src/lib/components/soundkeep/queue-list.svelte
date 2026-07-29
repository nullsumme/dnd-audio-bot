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

<Card.Root class="flex min-w-0 flex-col xl:min-h-0 xl:flex-1">
  <Card.Header class="shrink-0 flex-row items-center justify-between gap-2 pb-2">
    <Card.Title class="flex items-center gap-2 text-sm tracking-wide uppercase">
      <ListMusic class="size-4" />
      Queue
    </Card.Title>
    <Badge variant="outline">{soundkeep.visibleBackgroundAssets.length}</Badge>
  </Card.Header>
  <Card.Content class="flex min-h-0 min-w-0 flex-1 flex-col gap-2 pb-3">
    <div class="flex min-w-0 shrink-0 gap-1.5">
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
      <ScrollArea.Root class="min-h-40 flex-1">
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
