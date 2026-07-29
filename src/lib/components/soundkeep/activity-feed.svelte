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

<Card.Root class="flex min-w-0 flex-col xl:min-h-0 xl:flex-1">
  <Card.Header class="shrink-0 pb-2">
    <Card.Title class="flex items-center gap-2 text-sm tracking-wide uppercase">
      <Activity class="size-4" />
      Activity
    </Card.Title>
  </Card.Header>
  <Card.Content class="flex min-h-0 flex-1 flex-col pb-3">
    {#if soundkeep.state.activity.length === 0}
      <p class="metric-label py-3 text-center">No session activity yet.</p>
    {:else}
      <ScrollArea.Root class="min-h-40 flex-1">
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
