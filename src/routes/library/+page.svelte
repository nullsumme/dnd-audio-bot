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
