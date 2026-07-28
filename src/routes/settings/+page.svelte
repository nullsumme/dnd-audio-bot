<script lang="ts">
  import {
    Activity,
    Bot,
    CheckCircle2,
    CircleX,
    Cpu,
    Headphones,
    LogOut,
    Radio,
    Server,
    Volume2
  } from '@lucide/svelte';
  import * as Alert from '$lib/components/ui/alert';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import * as Field from '$lib/components/ui/field';
  import * as Select from '$lib/components/ui/select';
  import { Separator } from '$lib/components/ui/separator';
  import { Slider } from '$lib/components/ui/slider';
  import { Spinner } from '$lib/components/ui/spinner';
  import { useSoundkeep } from '$lib/soundkeep-client.svelte';

  const soundkeep = useSoundkeep();

  let selectedChannel = $state(
    soundkeep.state.discord.channelId ??
      soundkeep.state.guilds.flatMap((guild) => guild.voiceChannels)[0]?.id ??
      ''
  );
  let masterPercent = $state(Math.round(soundkeep.state.masterVolume * 100));

  $effect(() => {
    if (!selectedChannel) {
      selectedChannel =
        soundkeep.state.discord.channelId ??
        soundkeep.state.guilds.flatMap((guild) => guild.voiceChannels)[0]?.id ??
        '';
    }
  });

  async function changeMasterVolume(event: Event) {
    masterPercent = Number((event.currentTarget as HTMLInputElement).value);
    await soundkeep.changeMasterVolume(masterPercent / 100);
  }
</script>

<div class="flex flex-1 flex-col gap-6 p-4 md:p-6">
  <div class="flex flex-col gap-1">
    <h1 class="text-2xl font-semibold tracking-tight">Settings</h1>
    <p class="text-muted-foreground text-sm">
      Configure the Discord destination and inspect the audio runtime.
    </p>
  </div>

  {#if soundkeep.state.discord.error}
    <Alert.Root variant="destructive">
      <CircleX />
      <Alert.Title>Discord connection error</Alert.Title>
      <Alert.Description>{soundkeep.state.discord.error}</Alert.Description>
    </Alert.Root>
  {/if}

  <div class="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
    <div class="flex flex-col gap-6">
      <Card.Root>
        <Card.Header>
          <Card.Title class="flex items-center gap-2">
            <Headphones />
            Discord voice
          </Card.Title>
          <Card.Description>
            Choose the server channel that receives the live two-line mix.
          </Card.Description>
        </Card.Header>
        <Card.Content>
          <Field.Group>
            <Field.Field>
              <Field.Label for="voice-channel">Voice channel</Field.Label>
              <Select.Root type="single" bind:value={selectedChannel}>
                <Select.Trigger id="voice-channel" class="w-full">
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
              <Field.Description>
                Soundkeep can send audio to one voice channel at a time.
              </Field.Description>
            </Field.Field>
            <div class="flex justify-end">
              {#if soundkeep.state.discord.connected}
                <Button
                  variant="outline"
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
                  disabled={!selectedChannel ||
                    !soundkeep.state.discord.ready ||
                    soundkeep.busy !== null}
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

      <Card.Root>
        <Card.Header>
          <Card.Title class="flex items-center gap-2">
            <Volume2 />
            Master output
          </Card.Title>
          <Card.Description>
            Set the final gain after the background and soundboard lines are mixed.
          </Card.Description>
        </Card.Header>
        <Card.Content>
          <Field.Field orientation="horizontal">
            <Field.Content>
              <Field.Title>Output volume</Field.Title>
              <Field.Description>
                This affects both lines without changing their individual balance.
              </Field.Description>
            </Field.Content>
            <div class="flex w-full max-w-sm items-center gap-4">
              <Slider
                id="settings-master-volume"
                bind:value={masterPercent}
                aria-label="Master output volume"
                onchange={changeMasterVolume}
              />
              <span class="text-muted-foreground w-10 text-right text-xs tabular-nums">
                {masterPercent}%
              </span>
            </div>
          </Field.Field>
        </Card.Content>
      </Card.Root>
    </div>

    <div class="flex flex-col gap-6">
      <Card.Root>
        <Card.Header>
          <Card.Title class="flex items-center gap-2">
            <Bot />
            Bot status
          </Card.Title>
          <Card.Description>Current Discord gateway and voice state.</Card.Description>
        </Card.Header>
        <Card.Content class="flex flex-col gap-4">
          <div class="flex items-center justify-between gap-3">
            <span class="text-sm">Configuration</span>
            <Badge variant={soundkeep.state.discord.configured ? 'success' : 'warning'}>
              {soundkeep.state.discord.configured ? 'Configured' : 'Missing token'}
            </Badge>
          </div>
          <Separator />
          <div class="flex items-center justify-between gap-3">
            <span class="text-sm">Gateway</span>
            <Badge variant={soundkeep.state.discord.ready ? 'success' : 'outline'}>
              {soundkeep.state.discord.ready ? 'Ready' : 'Offline'}
            </Badge>
          </div>
          <Separator />
          <div class="flex items-center justify-between gap-3">
            <span class="text-sm">Voice connection</span>
            <Badge variant={soundkeep.state.discord.connected ? 'success' : 'outline'}>
              {soundkeep.state.discord.connected ? 'Connected' : 'Disconnected'}
            </Badge>
          </div>
          <Separator />
          <div class="flex items-center justify-between gap-3">
            <span class="text-sm">Audio player</span>
            <Badge variant="secondary">{soundkeep.state.discord.playerState}</Badge>
          </div>
        </Card.Content>
      </Card.Root>

      <Card.Root>
        <Card.Header>
          <Card.Title class="flex items-center gap-2">
            <Server />
            Runtime capabilities
          </Card.Title>
          <Card.Description>External tools available in this deployment.</Card.Description>
        </Card.Header>
        <Card.Content class="flex flex-col gap-4">
          {#each [['FFmpeg', soundkeep.state.capabilities.ffmpeg], ['FFprobe', soundkeep.state.capabilities.ffprobe], ['yt-dlp', soundkeep.state.capabilities.ytdlp]] as [label, available] (label)}
            <div class="flex items-center justify-between gap-3">
              <span class="flex items-center gap-2 text-sm">
                {#if label === 'yt-dlp'}<Activity />{:else}<Cpu />{/if}
                {label}
              </span>
              <Badge variant={available ? 'success' : 'warning'}>
                {#if available}<CheckCircle2 />{:else}<CircleX />{/if}
                {available ? 'Available' : 'Unavailable'}
              </Badge>
            </div>
          {/each}
        </Card.Content>
      </Card.Root>
    </div>
  </div>

  <Card.Root>
    <Card.Header>
      <Card.Title>Audio diagnostics</Card.Title>
      <Card.Description>Low-level values reported by the active voice pipeline.</Card.Description>
    </Card.Header>
    <Card.Content class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <div>
        <p class="text-muted-foreground text-xs">Encoder</p>
        <p class="mt-1 font-medium">{soundkeep.state.discord.audioDiagnostics.encoder}</p>
      </div>
      <div>
        <p class="text-muted-foreground text-xs">Bitrate</p>
        <p class="mt-1 font-medium">
          {Math.round(soundkeep.state.discord.audioDiagnostics.bitrate / 1_000)} kbps
        </p>
      </div>
      <div>
        <p class="text-muted-foreground text-xs">Audio buffer</p>
        <p class="mt-1 font-medium">
          {soundkeep.state.discord.audioDiagnostics.bufferMilliseconds} ms
        </p>
      </div>
      <div>
        <p class="text-muted-foreground text-xs">Missed frames</p>
        <p class="mt-1 font-medium">
          {soundkeep.state.discord.audioDiagnostics.missedFrames}
        </p>
      </div>
    </Card.Content>
  </Card.Root>
</div>
