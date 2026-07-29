<script lang="ts">
  import { Headphones, LogOut, Radio } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import * as Field from '$lib/components/ui/field';
  import * as Select from '$lib/components/ui/select';
  import { Spinner } from '$lib/components/ui/spinner';
  import { useSoundkeep } from '$lib/soundkeep-client.svelte';

  const soundkeep = useSoundkeep();

  let selectedChannel = $state(
    soundkeep.state.discord.channelId ??
      soundkeep.state.guilds.flatMap((guild) => guild.voiceChannels)[0]?.id ??
      ''
  );

  $effect(() => {
    if (!selectedChannel) {
      selectedChannel =
        soundkeep.state.discord.channelId ??
        soundkeep.state.guilds.flatMap((guild) => guild.voiceChannels)[0]?.id ??
        '';
    }
  });
</script>

<Card.Root class="min-w-0">
  <Card.Header class="pb-2">
    <Card.Title class="flex items-center gap-2 text-base">
      <Headphones class="size-4" />
      Discord voice
    </Card.Title>
    <Card.Description class="text-micro">
      Choose the server channel that receives the live two-line mix.
    </Card.Description>
  </Card.Header>
  <Card.Content>
    <Field.Group class="gap-3">
      <Field.Field>
        <Field.Label for="voice-channel">Voice channel</Field.Label>
        <Select.Root type="single" bind:value={selectedChannel}>
          <Select.Trigger id="voice-channel" class="h-8 w-full">
            <span class="truncate">{soundkeep.channelLabel(selectedChannel)}</span>
          </Select.Trigger>
          <Select.Content>
            {#each soundkeep.state.guilds as guild (guild.id)}
              <Select.Group>
                <Select.Label>{guild.name}</Select.Label>
                {#each guild.voiceChannels as channel (channel.id)}
                  <Select.Item value={channel.id}>{channel.name}</Select.Item>
                {/each}
              </Select.Group>
            {/each}
          </Select.Content>
        </Select.Root>
        <Field.Description class="text-micro">
          Soundkeep can send audio to one voice channel at a time.
        </Field.Description>
      </Field.Field>
      <div class="flex justify-end">
        {#if soundkeep.state.discord.connected}
          <Button
            variant="outline"
            size="sm"
            disabled={soundkeep.busy !== null}
            onclick={() => soundkeep.disconnect()}
          >
            {#if soundkeep.busy === 'disconnect'}
              <Spinner data-icon="inline-start" />
            {:else}
              <LogOut data-icon="inline-start" />
            {/if}
            Disconnect
          </Button>
        {:else}
          <Button
            size="sm"
            disabled={!selectedChannel || !soundkeep.state.discord.ready || soundkeep.busy !== null}
            onclick={() => soundkeep.connect(selectedChannel)}
          >
            {#if soundkeep.busy === 'connect'}
              <Spinner data-icon="inline-start" />
            {:else}
              <Radio data-icon="inline-start" />
            {/if}
            Connect
          </Button>
        {/if}
      </div>
    </Field.Group>
  </Card.Content>
</Card.Root>
