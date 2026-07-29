<script lang="ts">
  import { HardDrive } from '@lucide/svelte';
  import * as Card from '$lib/components/ui/card';
  import StatRow from '$lib/components/soundkeep/stat-row.svelte';
  import { useSoundkeep } from '$lib/soundkeep-client.svelte';
  import { formatBytes } from '$lib/utils';

  const soundkeep = useSoundkeep();
</script>

<Card.Root class="min-w-0">
  <Card.Header class="pb-2">
    <Card.Title class="flex items-center gap-2 text-sm tracking-wide uppercase">
      <HardDrive class="size-4" />
      Storage
    </Card.Title>
    <Card.Description class="text-micro">
      Audio and artwork persist in the configured volume.
    </Card.Description>
  </Card.Header>
  <Card.Content class="pb-3">
    <StatRow label="Local audio" value={formatBytes(soundkeep.totalLocalBytes)} />
    <StatRow label="Background assets" value={soundkeep.backgroundAssets.length} />
    <StatRow label="Soundboard buttons" value={soundkeep.soundboardAssets.length} />
    <StatRow label="Cached effects" value={soundkeep.state.pcmCache.entries} />
  </Card.Content>
</Card.Root>
