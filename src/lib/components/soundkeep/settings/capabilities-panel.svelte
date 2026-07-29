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
