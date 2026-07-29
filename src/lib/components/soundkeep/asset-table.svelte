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
