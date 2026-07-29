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
    class="grid min-w-0 flex-1 grid-cols-1 gap-3 p-3 md:p-4 xl:min-h-0 xl:grid-cols-[16rem_minmax(0,1fr)_17rem] xl:grid-rows-[minmax(0,1fr)]"
  >
    <div class="flex min-w-0 flex-col gap-3 xl:min-h-0">
      <SceneList
        oncreate={() => openEditor(null)}
        onedit={(scene) => openEditor(scene)}
        ondelete={(scene) => (deletingScene = scene)}
      />
      <QueueList />
    </div>

    <SoundboardGrid />

    <div class="flex min-w-0 flex-col gap-3 xl:min-h-0">
      <OutputPanel />
      <ActivityFeed />
    </div>
  </div>
</div>

<SceneEditorDialog bind:open={editorOpen} scene={editingScene} />
<SceneDeleteDialog scene={deletingScene} onclose={() => (deletingScene = null)} />
