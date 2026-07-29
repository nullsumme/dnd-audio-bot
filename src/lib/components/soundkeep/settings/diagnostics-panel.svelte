<script lang="ts">
  import { Cpu } from '@lucide/svelte';
  import * as Card from '$lib/components/ui/card';
  import StatRow from '$lib/components/soundkeep/stat-row.svelte';
  import { useSoundkeep } from '$lib/soundkeep-client.svelte';
  import { formatBytes } from '$lib/utils';

  const soundkeep = useSoundkeep();

  let diagnostics = $derived(soundkeep.state.discord.audioDiagnostics);
  let cache = $derived(soundkeep.state.pcmCache);

  function bitrateLabel(value: number | null, fallback: string) {
    return value === null ? fallback : `${Math.round(value / 1_000)} kbps`;
  }
</script>

<Card.Root class="min-w-0">
  <Card.Header class="pb-2">
    <Card.Title class="flex items-center gap-2 text-base">
      <Cpu class="size-4" />
      Audio diagnostics
    </Card.Title>
    <Card.Description class="text-micro">
      Low-level values reported by the active voice pipeline.
    </Card.Description>
  </Card.Header>
  <Card.Content class="grid gap-x-6 pb-3 md:grid-cols-2">
    <div>
      <StatRow label="Encoder" value={diagnostics.encoder} />
      <StatRow
        label="Configured bitrate"
        value={diagnostics.bitrateMode === 'auto'
          ? 'Auto'
          : `${Math.round(Number(diagnostics.bitrateMode) / 1_000)} kbps`}
      />
      <StatRow
        label="Discord channel limit"
        value={bitrateLabel(diagnostics.channelBitrate, 'Not connected')}
      />
      <StatRow
        label="Current output bitrate"
        value={bitrateLabel(diagnostics.bitrate, 'Inactive')}
      />
      <StatRow label="Packetization delay" value={`${diagnostics.packetizationMilliseconds} ms`} />
      <StatRow label="Missed frames" value={diagnostics.missedFrames} />
      <StatRow label="Discord filler frames" value={diagnostics.fillerFrames} />
    </div>
    <div>
      <StatRow label="Deferred partial frames" value={diagnostics.partialFramesDeferred} />
      <StatRow label="EOF frames padded" value={diagnostics.finalPartialFramesPadded} />
      <StatRow label="Stale frames dropped" value={diagnostics.staleFramesDropped} />
      <StatRow label="Cached effects" value={cache.entries} />
      <StatRow
        label="PCM cache"
        value={`${formatBytes(cache.bytes)} / ${formatBytes(cache.maxBytes)}`}
      />
      <StatRow label="Cache hits / misses" value={`${cache.hits} / ${cache.misses}`} />
      <StatRow
        label="Cache failures / evictions"
        value={`${cache.failures} / ${cache.evictions}`}
      />
    </div>
  </Card.Content>
</Card.Root>
