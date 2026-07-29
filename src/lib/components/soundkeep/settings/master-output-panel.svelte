<script lang="ts">
  import { Volume2 } from '@lucide/svelte';
  import * as Card from '$lib/components/ui/card';
  import { Slider } from '$lib/components/ui/slider';
  import { useSoundkeep } from '$lib/soundkeep-client.svelte';

  const soundkeep = useSoundkeep();

  let masterPercent = $state(Math.round(soundkeep.state.masterVolume * 100));

  $effect(() => {
    masterPercent = Math.round(soundkeep.state.masterVolume * 100);
  });

  async function change(event: Event) {
    masterPercent = Number((event.currentTarget as HTMLInputElement).value);
    await soundkeep.changeMasterVolume(masterPercent / 100);
  }
</script>

<Card.Root class="min-w-0">
  <Card.Header class="pb-2">
    <Card.Title class="flex items-center gap-2 text-base">
      <Volume2 class="size-4" />
      Master output
    </Card.Title>
    <Card.Description class="text-micro">
      The final gain applied after the background and soundboard lines are mixed. The transport dock
      carries the same control.
    </Card.Description>
  </Card.Header>
  <Card.Content class="flex items-center gap-3">
    <Slider
      id="settings-master-volume"
      bind:value={masterPercent}
      aria-label="Master output volume"
      onchange={change}
    />
    <span class="metric w-10 shrink-0 text-right">{masterPercent}%</span>
  </Card.Content>
</Card.Root>
