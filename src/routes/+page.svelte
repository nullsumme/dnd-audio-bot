<script lang="ts">
  import {
    AudioLines,
    CircleStop,
    FileAudio,
    Headphones,
    Library,
    Play,
    Radio,
    Volume2,
    WandSparkles,
    X
  } from '@lucide/svelte';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import * as Empty from '$lib/components/ui/empty';
  import * as Field from '$lib/components/ui/field';
  import * as Select from '$lib/components/ui/select';
  import { Separator } from '$lib/components/ui/separator';
  import { Slider } from '$lib/components/ui/slider';
  import { Spinner } from '$lib/components/ui/spinner';
  import { useSoundkeep } from '$lib/soundkeep-client.svelte';

  const soundkeep = useSoundkeep();

  let selectedBackground = $state(
    soundkeep.backgroundSource?.assetId ?? soundkeep.backgroundAssets[0]?.id ?? ''
  );
  let masterPercent = $state(Math.round(soundkeep.state.masterVolume * 100));

  $effect(() => {
    if (
      !selectedBackground ||
      !soundkeep.backgroundAssets.some((asset) => asset.id === selectedBackground)
    ) {
      selectedBackground =
        soundkeep.backgroundSource?.assetId ?? soundkeep.backgroundAssets[0]?.id ?? '';
    }
  });

  async function playSelectedBackground() {
    const asset = soundkeep.state.assets.find((item) => item.id === selectedBackground);
    if (asset) await soundkeep.playAsset(asset, 'ambience');
  }

  async function changeMasterVolume(event: Event) {
    masterPercent = Number((event.currentTarget as HTMLInputElement).value);
    await soundkeep.changeMasterVolume(masterPercent / 100);
  }
</script>

<div class="flex flex-1 flex-col gap-6 p-4 md:p-6">
  <div class="flex flex-col gap-1">
    <h1 class="text-2xl font-semibold tracking-tight">Session console</h1>
    <p class="text-muted-foreground text-sm">
      Control the live Discord mix without leaving the table.
    </p>
  </div>

  <section class="grid gap-4 md:grid-cols-2 xl:grid-cols-4" aria-label="Session summary">
    <Card.Root>
      <Card.Header>
        <Card.Description>Discord voice</Card.Description>
        <Card.Title class="flex items-center justify-between gap-3">
          <span class="truncate">
            {soundkeep.state.discord.connected
              ? `#${soundkeep.state.discord.channelName}`
              : 'Disconnected'}
          </span>
          <Headphones />
        </Card.Title>
      </Card.Header>
      <Card.Content>
        <p class="text-muted-foreground text-xs">
          {soundkeep.state.discord.guildName ?? 'No active server'}
        </p>
      </Card.Content>
    </Card.Root>

    <Card.Root>
      <Card.Header>
        <Card.Description>Audio library</Card.Description>
        <Card.Title class="flex items-center justify-between gap-3">
          <span>{soundkeep.state.assets.length} assets</span>
          <Library />
        </Card.Title>
      </Card.Header>
      <Card.Content>
        <a class="text-primary text-xs hover:underline" href="/library">Manage library</a>
      </Card.Content>
    </Card.Root>

    <Card.Root>
      <Card.Header>
        <Card.Description>Background line</Card.Description>
        <Card.Title class="flex items-center justify-between gap-3">
          <span class="truncate">{soundkeep.backgroundSource?.label ?? 'Idle'}</span>
          <AudioLines />
        </Card.Title>
      </Card.Header>
      <Card.Content>
        <Badge variant={soundkeep.backgroundSource ? 'success' : 'outline'}>
          {soundkeep.backgroundSource ? 'Looping' : 'Ready'}
        </Badge>
      </Card.Content>
    </Card.Root>

    <Card.Root>
      <Card.Header>
        <Card.Description>Soundboard line</Card.Description>
        <Card.Title class="flex items-center justify-between gap-3">
          <span class="truncate">{soundkeep.soundboardSource?.label ?? 'Idle'}</span>
          <WandSparkles />
        </Card.Title>
      </Card.Header>
      <Card.Content>
        <Badge variant={soundkeep.soundboardSource ? 'secondary' : 'outline'}>
          {soundkeep.soundboardSource ? 'Playing' : `${soundkeep.soundboardAssets.length} buttons`}
        </Badge>
      </Card.Content>
    </Card.Root>
  </section>

  <div class="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
    <Card.Root>
      <Card.Header>
        <div class="flex items-start justify-between gap-4">
          <div>
            <Card.Title class="flex items-center gap-2">
              <AudioLines />
              Background music
            </Card.Title>
            <Card.Description>
              Choose one ambience track. It loops until replaced or stopped.
            </Card.Description>
          </div>
          <Badge variant="outline">Line 1</Badge>
        </div>
      </Card.Header>
      <Card.Content class="flex flex-col gap-5">
        <Field.Field>
          <Field.Label for="background-select">Library selection</Field.Label>
          <div class="flex gap-2">
            <Select.Root type="single" bind:value={selectedBackground}>
              <Select.Trigger id="background-select" class="min-w-0 flex-1">
                <span class="truncate">
                  {soundkeep.state.assets.find((asset) => asset.id === selectedBackground)?.name ??
                    'Choose background audio'}
                </span>
              </Select.Trigger>
              <Select.Content>
                <Select.Group>
                  <Select.Label>Background library</Select.Label>
                  {#each soundkeep.backgroundAssets as asset (asset.id)}
                    <Select.Item value={asset.id}>{asset.name}</Select.Item>
                  {/each}
                </Select.Group>
              </Select.Content>
            </Select.Root>
            <Button
              disabled={!selectedBackground ||
                !soundkeep.state.discord.connected ||
                soundkeep.busy !== null}
              onclick={playSelectedBackground}
            >
              {#if soundkeep.busy?.startsWith('play-ambience')}
                <Spinner data-icon="inline-start" />
              {:else}
                <Play data-icon="inline-start" />
              {/if}
              Play
            </Button>
          </div>
        </Field.Field>

        {#if soundkeep.backgroundSource}
          <div class="bg-muted/40 flex items-center gap-4 rounded-xl p-4">
            <div
              class="bg-primary/10 text-primary grid size-11 shrink-0 place-items-center rounded-lg"
            >
              <FileAudio />
            </div>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-semibold">{soundkeep.backgroundSource.label}</p>
              <p class="text-muted-foreground mt-1 text-xs">
                {soundkeep.backgroundSource.state} · looping
              </p>
            </div>
            <div class="flex w-48 items-center gap-3">
              <Volume2 />
              <Slider
                value={Math.round(soundkeep.backgroundSource.volume * 100)}
                aria-label={`Volume for ${soundkeep.backgroundSource.label}`}
                onchange={(event) =>
                  soundkeep.changeSourceVolume(
                    soundkeep.backgroundSource!.id,
                    Number((event.currentTarget as HTMLInputElement).value) / 100
                  )}
              />
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Stop background"
              onclick={() => soundkeep.stopScope('ambience')}
            >
              <X />
            </Button>
          </div>
        {:else}
          <Empty.Root>
            <Empty.Header>
              <Empty.Media variant="icon"><AudioLines /></Empty.Media>
              <Empty.Title>No background is playing</Empty.Title>
              <Empty.Description>
                Add ambience to the library, then select it above.
              </Empty.Description>
            </Empty.Header>
          </Empty.Root>
        {/if}
      </Card.Content>
    </Card.Root>

    <Card.Root>
      <Card.Header>
        <Card.Title class="flex items-center gap-2">
          <Radio />
          Session output
        </Card.Title>
        <Card.Description>Master the two-line mix sent to Discord.</Card.Description>
      </Card.Header>
      <Card.Content class="flex flex-col gap-5">
        <Field.Field>
          <div class="flex items-center justify-between">
            <Field.Label for="master-volume">Master volume</Field.Label>
            <span class="text-muted-foreground text-xs tabular-nums">{masterPercent}%</span>
          </div>
          <Slider
            id="master-volume"
            bind:value={masterPercent}
            aria-label="Master volume"
            onchange={changeMasterVolume}
          />
        </Field.Field>
        <Separator />
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="text-sm font-medium">Background</p>
            <p class="text-muted-foreground text-xs">Continuous ambience</p>
          </div>
          <Badge variant={soundkeep.backgroundSource ? 'success' : 'outline'}>
            {soundkeep.backgroundSource ? 'Playing' : 'Idle'}
          </Badge>
        </div>
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="text-sm font-medium">Soundboard</p>
            <p class="text-muted-foreground text-xs">One-shot effects</p>
          </div>
          <Badge variant={soundkeep.soundboardSource ? 'secondary' : 'outline'}>
            {soundkeep.soundboardSource ? 'Playing' : 'Idle'}
          </Badge>
        </div>
        <Button
          variant="destructive"
          disabled={!soundkeep.backgroundSource && !soundkeep.soundboardSource}
          onclick={() => soundkeep.stopScope('all')}
        >
          <CircleStop data-icon="inline-start" />
          Stop all audio
        </Button>
      </Card.Content>
    </Card.Root>
  </div>

  <Card.Root class="min-h-[360px]">
    <Card.Header>
      <div class="flex items-start justify-between gap-4">
        <div>
          <Card.Title class="flex items-center gap-2">
            <WandSparkles />
            Soundboard
          </Card.Title>
          <Card.Description>
            Trigger line 2 while the background continues uninterrupted.
          </Card.Description>
        </div>
        <div class="flex items-center gap-2">
          {#if soundkeep.soundboardSource}
            <Badge variant="secondary" class="max-w-48 truncate">
              {soundkeep.soundboardSource.label}
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Stop soundboard"
              onclick={() => soundkeep.stopScope('soundboard')}
            >
              <CircleStop />
            </Button>
          {/if}
          <Badge variant="outline">Line 2</Badge>
        </div>
      </div>
    </Card.Header>
    <Card.Content>
      {#if soundkeep.soundboardAssets.length === 0}
        <Empty.Root>
          <Empty.Header>
            <Empty.Media variant="icon"><WandSparkles /></Empty.Media>
            <Empty.Title>No soundboard buttons</Empty.Title>
            <Empty.Description>
              Add library items to the soundboard from the Library page.
            </Empty.Description>
          </Empty.Header>
          <Empty.Content>
            <Button href="/library" variant="outline">Open library</Button>
          </Empty.Content>
        </Empty.Root>
      {:else}
        <div class="grid gap-6 lg:grid-cols-2 2xl:grid-cols-3">
          {#each soundkeep.soundboardGroups() as [category, assets] (category)}
            <section class="flex flex-col gap-3" aria-labelledby={`category-${category}`}>
              <div class="flex items-center gap-3">
                <h3 id={`category-${category}`} class="text-sm font-semibold">{category}</h3>
                <Separator class="flex-1" />
              </div>
              <div class="grid grid-cols-2 gap-2">
                {#each assets as asset (asset.id)}
                  <Button
                    variant="outline"
                    class="h-auto min-h-14 justify-start"
                    disabled={!soundkeep.state.discord.connected || soundkeep.busy !== null}
                    onclick={() => soundkeep.playAsset(asset, 'soundboard')}
                  >
                    {#if soundkeep.busy === `play-soundboard-${asset.id}`}
                      <Spinner data-icon="inline-start" />
                    {:else}
                      <Play data-icon="inline-start" />
                    {/if}
                    <span class="truncate">{asset.name}</span>
                  </Button>
                {/each}
              </div>
            </section>
          {/each}
        </div>
      {/if}
    </Card.Content>
  </Card.Root>
</div>
