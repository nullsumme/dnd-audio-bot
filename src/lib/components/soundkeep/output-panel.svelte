<script lang="ts">
  import { CircleStop, Gauge, Radio } from '@lucide/svelte';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import StatRow from '$lib/components/soundkeep/stat-row.svelte';
  import { useSoundkeep } from '$lib/soundkeep-client.svelte';

  const soundkeep = useSoundkeep();

  let bitrateLabel = $derived.by(() => {
    const diagnostics = soundkeep.state.discord.audioDiagnostics;
    if (diagnostics.bitrate !== null) return `${Math.round(diagnostics.bitrate / 1_000)} kbps`;
    if (diagnostics.bitrateMode === 'auto') return 'Auto';
    return `${Math.round(Number(diagnostics.bitrateMode) / 1_000)} kbps target`;
  });
</script>

<Card.Root class="min-w-0">
  <Card.Header class="flex-row items-center justify-between gap-2 pb-2">
    <Card.Title class="flex items-center gap-2 text-sm tracking-wide uppercase">
      <Gauge class="size-4" />
      Output
    </Card.Title>
    <Badge variant={soundkeep.state.discord.connected ? 'success' : 'outline'}>
      <Radio />
      {soundkeep.state.discord.connected ? 'Live' : 'Offline'}
    </Badge>
  </Card.Header>
  <Card.Content class="flex flex-col gap-2 pb-3">
    <div>
      <StatRow label="Channel" value={soundkeep.state.discord.channelName ?? 'Not connected'} />
      <StatRow label="Listeners" value={soundkeep.state.discord.listenerCount} />
      <StatRow label="Bitrate" value={bitrateLabel} />
      <StatRow label="Player" value={soundkeep.state.discord.playerState} />
    </div>
    <Button
      variant="destructive"
      size="sm"
      disabled={!soundkeep.backgroundSource && !soundkeep.soundboardSource}
      onclick={() => soundkeep.stopScope('all')}
    >
      <CircleStop data-icon="inline-start" />
      Stop all audio
    </Button>
  </Card.Content>
</Card.Root>
