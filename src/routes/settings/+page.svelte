<script lang="ts">
  import { CircleX } from '@lucide/svelte';
  import * as Alert from '$lib/components/ui/alert';
  import BotStatusPanel from '$lib/components/soundkeep/settings/bot-status-panel.svelte';
  import CapabilitiesPanel from '$lib/components/soundkeep/settings/capabilities-panel.svelte';
  import DiagnosticsPanel from '$lib/components/soundkeep/settings/diagnostics-panel.svelte';
  import MasterOutputPanel from '$lib/components/soundkeep/settings/master-output-panel.svelte';
  import QualityPanel from '$lib/components/soundkeep/settings/quality-panel.svelte';
  import VoicePanel from '$lib/components/soundkeep/settings/voice-panel.svelte';
  import { useSoundkeep } from '$lib/soundkeep-client.svelte';

  const soundkeep = useSoundkeep();
</script>

<div class="flex min-w-0 flex-1 flex-col">
  <div class="bg-card/35 shrink-0 border-b px-3 py-2 md:px-4">
    <h1 class="font-display text-base font-semibold tracking-tight">Settings</h1>
    <p class="metric-label truncate">
      Configure the Discord destination and inspect the audio runtime.
    </p>
  </div>

  <div class="flex min-w-0 flex-1 flex-col gap-3 p-3 md:p-4">
    {#if soundkeep.state.discord.error}
      <Alert.Root variant="destructive">
        <CircleX />
        <Alert.Title>Discord connection error</Alert.Title>
        <Alert.Description>{soundkeep.state.discord.error}</Alert.Description>
      </Alert.Root>
    {/if}

    <div
      class="grid min-w-0 items-start gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]"
    >
      <div class="flex min-w-0 flex-col gap-3">
        <VoicePanel />
        <QualityPanel />
        <MasterOutputPanel />
      </div>
      <div class="flex min-w-0 flex-col gap-3">
        <BotStatusPanel />
        <CapabilitiesPanel />
      </div>
    </div>

    <DiagnosticsPanel />
  </div>
</div>
