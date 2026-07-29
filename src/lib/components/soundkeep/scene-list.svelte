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
