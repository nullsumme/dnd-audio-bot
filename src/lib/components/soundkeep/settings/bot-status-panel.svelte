<script lang="ts">
  import { Bot } from '@lucide/svelte';
  import { Badge } from '$lib/components/ui/badge';
  import * as Card from '$lib/components/ui/card';
  import StatRow from '$lib/components/soundkeep/stat-row.svelte';
  import { useSoundkeep } from '$lib/soundkeep-client.svelte';

  const soundkeep = useSoundkeep();
</script>

<Card.Root class="min-w-0">
  <Card.Header class="pb-2">
    <Card.Title class="flex items-center gap-2 text-base">
      <Bot class="size-4" />
      Bot status
    </Card.Title>
    <Card.Description class="text-micro">Current Discord gateway and voice state.</Card.Description>
  </Card.Header>
  <Card.Content class="pb-3">
    <StatRow label="Configuration">
      <Badge variant={soundkeep.state.discord.configured ? 'success' : 'warning'}>
        {soundkeep.state.discord.configured ? 'Configured' : 'Missing token'}
      </Badge>
    </StatRow>
    <StatRow label="Gateway">
      <Badge variant={soundkeep.state.discord.ready ? 'success' : 'outline'}>
        {soundkeep.state.discord.ready ? 'Ready' : 'Offline'}
      </Badge>
    </StatRow>
    <StatRow label="Voice connection">
      <Badge variant={soundkeep.state.discord.connected ? 'success' : 'outline'}>
        {soundkeep.state.discord.connected ? 'Connected' : 'Disconnected'}
      </Badge>
    </StatRow>
    <StatRow label="Audio player">
      <Badge variant="secondary">{soundkeep.state.discord.playerState}</Badge>
    </StatRow>
    <StatRow label="Bot" value={soundkeep.state.discord.botName ?? 'Unknown'} />
  </Card.Content>
</Card.Root>
