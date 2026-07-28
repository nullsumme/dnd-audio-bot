<script lang="ts">
  import { onMount } from 'svelte';
  import { toast } from 'svelte-sonner';
  import {
    AudioLines,
    Bot,
    CircleStop,
    Cloud,
    Download,
    ExternalLink,
    FileAudio,
    Headphones,
    Library,
    Link2,
    LogOut,
    Pencil,
    Play,
    Plus,
    Radio,
    RefreshCw,
    Search,
    Trash2,
    Upload,
    Volume2,
    WandSparkles,
    X
  } from '@lucide/svelte';
  import * as Alert from '$lib/components/ui/alert';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Empty from '$lib/components/ui/empty';
  import * as Field from '$lib/components/ui/field';
  import { Input } from '$lib/components/ui/input';
  import * as InputGroup from '$lib/components/ui/input-group';
  import * as Select from '$lib/components/ui/select';
  import { Separator } from '$lib/components/ui/separator';
  import { Slider } from '$lib/components/ui/slider';
  import { Spinner } from '$lib/components/ui/spinner';
  import * as Tabs from '$lib/components/ui/tabs';
  import * as ToggleGroup from '$lib/components/ui/toggle-group';
  import type { ApplicationState, AssetRole, AudioAsset, AudioAssetType } from '$lib/types';
  import { formatBytes, formatDuration } from '$lib/utils';

  const emptyState: ApplicationState = {
    discord: {
      configured: false,
      ready: false,
      botName: null,
      botAvatarUrl: null,
      connected: false,
      guildId: null,
      guildName: null,
      channelId: null,
      channelName: null,
      playerState: 'idle',
      playableConnections: 0,
      subscribed: false,
      audioDiagnostics: {
        encoder: 'ffmpeg/libopus',
        bitrate: 64_000,
        bufferMilliseconds: 200,
        missedFrames: 0,
        fillerFrames: 0,
        playerPlaybackMilliseconds: 0,
        resourcePlaybackMilliseconds: 0
      },
      error: null
    },
    guilds: [],
    sources: [],
    assets: [],
    masterVolume: 0.8,
    capabilities: { ffmpeg: false, ffprobe: false, ytdlp: false }
  };

  let appState = $state<ApplicationState>(emptyState);
  let initialLoading = $state(true);
  let refreshing = $state(false);
  let busy = $state<string | null>(null);
  let selectedChannel = $state('');
  let selectedBackground = $state('');
  let masterPercent = $state(80);
  let librarySearch = $state('');
  let libraryTab = $state('upload');

  let uploadFile = $state<File | null>(null);
  let uploadName = $state('');
  let uploadCategory = $state('');
  let uploadRole = $state<AssetRole>('ambience');

  let youtubeUrl = $state('');
  let youtubeName = $state('');
  let youtubeCategory = $state('');
  let youtubeRole = $state<AssetRole>('ambience');
  let youtubeMode = $state<'live' | 'saved'>('live');

  let editOpen = $state(false);
  let editingAsset = $state<AudioAsset | null>(null);
  let editName = $state('');
  let editCategory = $state('');
  let editRole = $state<AssetRole>('ambience');

  let deleteOpen = $state(false);
  let deletingAsset = $state<AudioAsset | null>(null);
  let previewAudio: HTMLAudioElement | null = null;

  let backgroundSource = $derived(
    appState.sources.find((source) => source.role === 'ambience') ?? null
  );
  let soundboardSource = $derived(
    appState.sources.find((source) => source.role === 'soundboard') ?? null
  );
  let backgroundAssets = $derived(appState.assets.filter((asset) => asset.role === 'ambience'));
  let soundboardAssets = $derived(appState.assets.filter((asset) => asset.role === 'soundboard'));
  let filteredAssets = $derived(
    appState.assets.filter((asset) => {
      const query = librarySearch.trim().toLowerCase();
      return (
        !query ||
        asset.name.toLowerCase().includes(query) ||
        asset.category.toLowerCase().includes(query) ||
        sourceTypeLabel(asset.sourceType).toLowerCase().includes(query)
      );
    })
  );
  let totalLocalBytes = $derived(appState.assets.reduce((total, asset) => total + asset.size, 0));

  onMount(() => {
    void refresh(true);
    const interval = window.setInterval(() => void refresh(false), 2_500);
    return () => {
      window.clearInterval(interval);
      previewAudio?.pause();
    };
  });

  async function request<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, {
      ...init,
      headers:
        init?.body instanceof FormData
          ? init.headers
          : { 'content-type': 'application/json', ...init?.headers }
    });
    const body = (await response.json().catch(() => ({}))) as T & { message?: string };
    if (!response.ok) throw new Error(body.message || `Request failed with ${response.status}.`);
    return body;
  }

  async function refresh(firstLoad = false) {
    if (refreshing) return;
    refreshing = true;
    try {
      appState = await request<ApplicationState>('/api/state');
      if (!busy) masterPercent = Math.round(appState.masterVolume * 100);
      if (!selectedChannel) {
        selectedChannel =
          appState.discord.channelId ??
          appState.guilds.flatMap((guild) => guild.voiceChannels)[0]?.id ??
          '';
      }
      if (
        !selectedBackground ||
        !appState.assets.some((asset) => asset.id === selectedBackground)
      ) {
        selectedBackground =
          appState.sources.find((source) => source.role === 'ambience')?.assetId ??
          appState.assets.find((asset) => asset.role === 'ambience')?.id ??
          '';
      }
    } catch (error) {
      if (firstLoad) showError(error);
    } finally {
      refreshing = false;
      if (firstLoad) initialLoading = false;
    }
  }

  async function run(label: string, action: () => Promise<unknown>, success?: string) {
    busy = label;
    try {
      await action();
      await refresh(false);
      if (success) toast.success(success);
      return true;
    } catch (error) {
      showError(error);
      return false;
    } finally {
      busy = null;
    }
  }

  function showError(error: unknown) {
    toast.error(error instanceof Error ? error.message : 'Something went wrong.');
  }

  async function connect() {
    if (!selectedChannel) return;
    await run(
      'connect',
      () =>
        request('/api/discord/connect', {
          method: 'POST',
          body: JSON.stringify({ channelId: selectedChannel })
        }),
      'Connected to the voice channel.'
    );
  }

  async function disconnect() {
    await run(
      'disconnect',
      () => request('/api/discord/disconnect', { method: 'POST', body: '{}' }),
      'Disconnected from Discord voice.'
    );
  }

  async function playAsset(asset: AudioAsset, role: AssetRole) {
    await run(
      `play-${role}-${asset.id}`,
      () =>
        request(`/api/audio/library/${asset.id}/play`, {
          method: 'POST',
          body: JSON.stringify({ role, volume: role === 'ambience' ? 0.65 : 0.85 })
        }),
      role === 'ambience' ? `${asset.name} is now the background.` : undefined
    );
  }

  async function playSelectedBackground() {
    const asset = appState.assets.find((item) => item.id === selectedBackground);
    if (asset) await playAsset(asset, 'ambience');
  }

  async function stopScope(scope: 'ambience' | 'soundboard' | 'all') {
    await run(`stop-${scope}`, () =>
      request('/api/audio/stop', {
        method: 'POST',
        body: JSON.stringify({ scope })
      })
    );
  }

  async function changeSourceVolume(id: string, event: Event) {
    const volume = Number((event.currentTarget as HTMLInputElement).value) / 100;
    await request(`/api/audio/sources/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ volume })
    }).catch(showError);
  }

  async function changeMasterVolume(event: Event) {
    masterPercent = Number((event.currentTarget as HTMLInputElement).value);
    await request('/api/audio/master', {
      method: 'PATCH',
      body: JSON.stringify({ volume: masterPercent / 100 })
    }).catch(showError);
  }

  async function uploadAsset() {
    if (!uploadFile) return showError(new Error('Choose an MP3 file first.'));
    const form = new FormData();
    form.set('file', uploadFile);
    form.set('name', uploadName);
    form.set('category', uploadCategory);
    form.set('role', uploadRole);
    const completed = await run(
      'upload',
      () => request('/api/library', { method: 'POST', body: form }),
      `${uploadName || uploadFile.name} was added to the library.`
    );
    if (completed) {
      uploadFile = null;
      uploadName = '';
      uploadCategory = '';
      const input = document.querySelector<HTMLInputElement>('#audio-upload');
      if (input) input.value = '';
    }
  }

  async function addYouTubeAsset() {
    if (!youtubeUrl.trim()) return;
    const completed = await run(
      'youtube',
      () =>
        request('/api/library/youtube', {
          method: 'POST',
          body: JSON.stringify({
            url: youtubeUrl,
            mode: youtubeMode,
            name: youtubeName,
            category: youtubeCategory,
            role: youtubeRole
          })
        }),
      youtubeMode === 'saved'
        ? 'YouTube audio was downloaded and saved as MP3.'
        : 'Live YouTube stream was added to the library.'
    );
    if (completed) {
      youtubeUrl = '';
      youtubeName = '';
      youtubeCategory = '';
    }
  }

  async function setAssetRole(asset: AudioAsset, role: AssetRole) {
    await run(
      `role-${asset.id}`,
      () =>
        request(`/api/library/${asset.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ role })
        }),
      role === 'soundboard'
        ? `${asset.name} was added to the soundboard.`
        : `${asset.name} was removed from the soundboard.`
    );
  }

  function beginEdit(asset: AudioAsset) {
    editingAsset = asset;
    editName = asset.name;
    editCategory = asset.category;
    editRole = asset.role;
    editOpen = true;
  }

  async function saveEdit() {
    if (!editingAsset) return;
    const completed = await run(
      `edit-${editingAsset.id}`,
      () =>
        request(`/api/library/${editingAsset!.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: editName, category: editCategory, role: editRole })
        }),
      'Library entry updated.'
    );
    if (completed) editOpen = false;
  }

  function beginDelete(asset: AudioAsset) {
    deletingAsset = asset;
    deleteOpen = true;
  }

  async function confirmDelete() {
    if (!deletingAsset) return;
    const name = deletingAsset.name;
    const completed = await run(
      `delete-${deletingAsset.id}`,
      () => request(`/api/library/${deletingAsset!.id}`, { method: 'DELETE', body: '{}' }),
      `${name} was deleted from the library.`
    );
    if (completed) {
      deleteOpen = false;
      deletingAsset = null;
    }
  }

  function preview(asset: AudioAsset) {
    if (!asset.filename) return;
    previewAudio?.pause();
    previewAudio = new Audio(`/api/library/${asset.id}/file`);
    previewAudio.volume = 0.7;
    void previewAudio.play().catch(showError);
  }

  function sourceTypeLabel(type: AudioAssetType): string {
    if (type === 'youtube-live') return 'Live YouTube';
    if (type === 'youtube-saved') return 'Saved YouTube MP3';
    return 'Uploaded MP3';
  }

  function channelLabel(id: string): string {
    for (const guild of appState.guilds) {
      const channel = guild.voiceChannels.find((item) => item.id === id);
      if (channel) return `${guild.name} · ${channel.name}`;
    }
    return 'Choose a voice channel';
  }

  function assetLabel(id: string): string {
    return appState.assets.find((asset) => asset.id === id)?.name ?? 'Choose background audio';
  }

  function soundboardGroups(): Array<[string, AudioAsset[]]> {
    const groups = new Map<string, AudioAsset[]>();
    for (const asset of soundboardAssets) {
      groups.set(asset.category, [...(groups.get(asset.category) ?? []), asset]);
    }
    return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
  }
</script>

<svelte:head>
  <title>Soundkeep · D&D audio control</title>
  <meta
    name="description"
    content="A desktop Discord background music and soundboard controller for tabletop sessions."
  />
</svelte:head>

{#if initialLoading}
  <div class="flex min-h-screen items-center justify-center">
    <Spinner class="text-primary" />
    <span class="text-muted-foreground ml-3 text-sm">Opening Soundkeep…</span>
  </div>
{:else}
  <div class="mx-auto min-h-screen w-full max-w-[1800px] p-5 lg:p-7">
    <header class="mb-5 flex min-h-16 items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="bg-primary/10 text-primary grid size-10 place-items-center rounded-xl">
          <WandSparkles />
        </div>
        <div>
          <h1 class="font-display text-xl font-semibold tracking-tight">Soundkeep</h1>
          <p class="text-muted-foreground text-xs">Game master audio console</p>
        </div>
      </div>

      <div class="flex items-center gap-3">
        <Badge variant={appState.discord.connected ? 'success' : 'outline'}>
          {appState.discord.connected ? `#${appState.discord.channelName}` : 'Voice disconnected'}
        </Badge>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Refresh state"
          disabled={refreshing}
          onclick={() => refresh(false)}
        >
          <RefreshCw class={refreshing ? 'animate-spin' : undefined} />
        </Button>
      </div>
    </header>

    {#if !appState.discord.configured || !appState.capabilities.ffmpeg || !appState.capabilities.ffprobe || !appState.capabilities.ytdlp}
      <Alert.Root class="mb-5" variant={!appState.discord.configured ? 'destructive' : 'default'}>
        <Bot />
        <Alert.Title>Server setup needs attention</Alert.Title>
        <Alert.Description>
          {#if !appState.discord.configured}Discord token missing.
          {/if}
          {#if !appState.capabilities.ffmpeg}FFmpeg is unavailable.
          {/if}
          {#if !appState.capabilities.ffprobe}FFprobe is unavailable.
          {/if}
          {#if !appState.capabilities.ytdlp}yt-dlp is unavailable.{/if}
        </Alert.Description>
      </Alert.Root>
    {/if}

    <main class="grid grid-cols-1 gap-5 xl:grid-cols-[280px_minmax(0,1fr)_420px]">
      <aside class="flex flex-col gap-5">
        <Card.Root>
          <Card.Header>
            <Card.Title class="flex items-center gap-2">
              <Headphones />
              Discord voice
            </Card.Title>
            <Card.Description>Send the mixed output to one channel.</Card.Description>
          </Card.Header>
          <Card.Content>
            <Field.Group>
              <Field.Field>
                <Field.Label for="voice-channel">Voice channel</Field.Label>
                <Select.Root type="single" bind:value={selectedChannel}>
                  <Select.Trigger id="voice-channel" class="w-full">
                    <span class="truncate">{channelLabel(selectedChannel)}</span>
                  </Select.Trigger>
                  <Select.Content>
                    {#each appState.guilds as guild (guild.id)}
                      <Select.Group>
                        <Select.Label>{guild.name}</Select.Label>
                        {#each guild.voiceChannels as channel (channel.id)}
                          <Select.Item value={channel.id}>{channel.name}</Select.Item>
                        {/each}
                      </Select.Group>
                    {/each}
                  </Select.Content>
                </Select.Root>
              </Field.Field>
              {#if appState.discord.connected}
                <Button variant="outline" disabled={busy !== null} onclick={disconnect}>
                  <LogOut data-icon="inline-start" />
                  Disconnect
                </Button>
              {:else}
                <Button
                  disabled={!selectedChannel || !appState.discord.ready || busy !== null}
                  onclick={connect}
                >
                  {#if busy === 'connect'}
                    <Spinner data-icon="inline-start" />
                  {:else}
                    <Radio data-icon="inline-start" />
                  {/if}
                  Connect
                </Button>
              {/if}
            </Field.Group>
          </Card.Content>
        </Card.Root>

        <Card.Root>
          <Card.Header>
            <Card.Title class="flex items-center gap-2">
              <Volume2 />
              Master output
            </Card.Title>
            <Card.Description>Gain after the two lines are mixed.</Card.Description>
          </Card.Header>
          <Card.Content>
            <Field.Field>
              <div class="flex items-center justify-between">
                <Field.Label for="master-volume">Volume</Field.Label>
                <span class="text-muted-foreground text-xs tabular-nums">{masterPercent}%</span>
              </div>
              <Slider
                id="master-volume"
                bind:value={masterPercent}
                aria-label="Master volume"
                onchange={changeMasterVolume}
              />
            </Field.Field>
          </Card.Content>
        </Card.Root>

        <Card.Root>
          <Card.Header>
            <Card.Title>Two-line mixer</Card.Title>
            <Card.Description>One looping background plus one soundboard clip.</Card.Description>
          </Card.Header>
          <Card.Content class="flex flex-col gap-3">
            <div class="flex items-center justify-between">
              <span class="text-sm">Background</span>
              <Badge variant={backgroundSource ? 'success' : 'outline'}>
                {backgroundSource ? 'Playing' : 'Idle'}
              </Badge>
            </div>
            <Separator />
            <div class="flex items-center justify-between">
              <span class="text-sm">Soundboard</span>
              <Badge variant={soundboardSource ? 'secondary' : 'outline'}>
                {soundboardSource ? 'Playing' : 'Idle'}
              </Badge>
            </div>
            <Button
              variant="destructive"
              disabled={!backgroundSource && !soundboardSource}
              onclick={() => stopScope('all')}
            >
              <CircleStop data-icon="inline-start" />
              Stop both lines
            </Button>
          </Card.Content>
        </Card.Root>
      </aside>

      <section class="flex min-w-0 flex-col gap-5">
        <Card.Root>
          <Card.Header>
            <div class="flex items-start justify-between gap-4">
              <div>
                <Card.Title class="flex items-center gap-2">
                  <AudioLines />
                  Background music
                </Card.Title>
                <Card.Description>
                  Select one library item. It loops until replaced or stopped.
                </Card.Description>
              </div>
              <Badge variant={backgroundSource ? 'success' : 'outline'}>Line 1</Badge>
            </div>
          </Card.Header>
          <Card.Content class="flex flex-col gap-4">
            <Field.Field>
              <Field.Label for="background-select">Library selection</Field.Label>
              <div class="flex gap-2">
                <Select.Root type="single" bind:value={selectedBackground}>
                  <Select.Trigger id="background-select" class="min-w-0 flex-1">
                    <span class="truncate">{assetLabel(selectedBackground)}</span>
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Group>
                      <Select.Label>Background library</Select.Label>
                      {#each backgroundAssets as asset (asset.id)}
                        <Select.Item value={asset.id}>
                          {asset.name} · {sourceTypeLabel(asset.sourceType)}
                        </Select.Item>
                      {/each}
                    </Select.Group>
                  </Select.Content>
                </Select.Root>
                <Button
                  disabled={!selectedBackground || !appState.discord.connected || busy !== null}
                  onclick={playSelectedBackground}
                >
                  {#if busy?.startsWith('play-ambience')}
                    <Spinner data-icon="inline-start" />
                  {:else}
                    <Play data-icon="inline-start" />
                  {/if}
                  Play
                </Button>
              </div>
            </Field.Field>

            {#if backgroundSource}
              <div class="bg-muted/40 flex items-center gap-4 rounded-xl p-4">
                <div
                  class="bg-primary/10 text-primary grid size-11 shrink-0 place-items-center rounded-lg"
                >
                  {#if backgroundSource.origin === 'youtube'}<Cloud />{:else}<FileAudio />{/if}
                </div>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-semibold">{backgroundSource.label}</p>
                  <p class="text-muted-foreground mt-1 text-xs">
                    {backgroundSource.state} · looping
                  </p>
                </div>
                <div class="flex w-48 items-center gap-3">
                  <Volume2 />
                  <Slider
                    value={Math.round(backgroundSource.volume * 100)}
                    aria-label={`Volume for ${backgroundSource.label}`}
                    onchange={(event) => changeSourceVolume(backgroundSource!.id, event)}
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Stop background"
                  onclick={() => stopScope('ambience')}
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
                    Add audio to the background library, then select it above.
                  </Empty.Description>
                </Empty.Header>
              </Empty.Root>
            {/if}
          </Card.Content>
        </Card.Root>

        <Card.Root class="min-h-[460px]">
          <Card.Header>
            <div class="flex items-start justify-between gap-4">
              <div>
                <Card.Title class="flex items-center gap-2">
                  <WandSparkles />
                  Soundboard
                </Card.Title>
                <Card.Description>
                  Buttons play on line 2 while background music continues.
                </Card.Description>
              </div>
              <div class="flex items-center gap-2">
                {#if soundboardSource}
                  <Badge variant="secondary" class="max-w-48 truncate">
                    {soundboardSource.label}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Stop soundboard"
                    onclick={() => stopScope('soundboard')}
                  >
                    <CircleStop />
                  </Button>
                {/if}
                <Badge variant="outline">Line 2</Badge>
              </div>
            </div>
          </Card.Header>
          <Card.Content>
            {#if soundboardAssets.length === 0}
              <Empty.Root>
                <Empty.Header>
                  <Empty.Media variant="icon"><WandSparkles /></Empty.Media>
                  <Empty.Title>No soundboard buttons</Empty.Title>
                  <Empty.Description>
                    Add any library item to the soundboard from the library panel.
                  </Empty.Description>
                </Empty.Header>
              </Empty.Root>
            {:else}
              <div class="flex flex-col gap-6">
                {#each soundboardGroups() as [category, assets] (category)}
                  <section aria-labelledby={`category-${category}`}>
                    <div class="mb-3 flex items-center gap-3">
                      <h3
                        id={`category-${category}`}
                        class="text-muted-foreground text-xs font-semibold tracking-wide uppercase"
                      >
                        {category}
                      </h3>
                      <Separator class="flex-1" />
                    </div>
                    <div class="grid grid-cols-2 gap-3 2xl:grid-cols-3">
                      {#each assets as asset (asset.id)}
                        <Button
                          variant="outline"
                          size="lg"
                          class="h-auto min-h-20 justify-start"
                          disabled={!appState.discord.connected || busy !== null}
                          onclick={() => playAsset(asset, 'soundboard')}
                        >
                          {#if busy === `play-soundboard-${asset.id}`}
                            <Spinner data-icon="inline-start" />
                          {:else}
                            <Play data-icon="inline-start" />
                          {/if}
                          <span class="min-w-0 text-left">
                            <span class="block truncate">{asset.name}</span>
                            <span class="text-muted-foreground mt-1 block text-xs font-normal">
                              {formatDuration(asset.duration)}
                            </span>
                          </span>
                        </Button>
                      {/each}
                    </div>
                  </section>
                {/each}
              </div>
            {/if}
          </Card.Content>
        </Card.Root>
      </section>

      <aside class="min-w-0">
        <Card.Root class="xl:sticky xl:top-5">
          <Card.Header>
            <div class="flex items-start justify-between gap-3">
              <div>
                <Card.Title class="flex items-center gap-2">
                  <Library />
                  Audio library
                </Card.Title>
                <Card.Description>
                  Live YouTube, saved YouTube MP3, and uploaded MP3.
                </Card.Description>
              </div>
              <Badge variant="outline">{formatBytes(totalLocalBytes)}</Badge>
            </div>
          </Card.Header>
          <Card.Content class="flex flex-col gap-4">
            <Tabs.Root bind:value={libraryTab}>
              <Tabs.List class="w-full">
                <Tabs.Trigger value="upload" class="flex-1">
                  <Upload />
                  MP3 upload
                </Tabs.Trigger>
                <Tabs.Trigger value="youtube" class="flex-1">
                  <Link2 />
                  YouTube
                </Tabs.Trigger>
              </Tabs.List>

              <Tabs.Content value="upload">
                <form
                  class="pt-4"
                  onsubmit={(event) => {
                    event.preventDefault();
                    void uploadAsset();
                  }}
                >
                  <Field.Group>
                    <Field.Field>
                      <Field.Label for="audio-upload">MP3 file</Field.Label>
                      <Input
                        id="audio-upload"
                        type="file"
                        accept=".mp3,audio/mpeg"
                        onchange={(event) => {
                          uploadFile = (event.currentTarget as HTMLInputElement).files?.[0] ?? null;
                          if (uploadFile && !uploadName) {
                            uploadName = uploadFile.name.replace(/\.mp3$/i, '');
                          }
                        }}
                      />
                    </Field.Field>
                    <Field.Field>
                      <Field.Label for="upload-name">Display name</Field.Label>
                      <Input id="upload-name" bind:value={uploadName} />
                    </Field.Field>
                    <div class="grid grid-cols-2 gap-3">
                      <Field.Field>
                        <Field.Label for="upload-category">Category</Field.Label>
                        <Input
                          id="upload-category"
                          placeholder="e.g. Weather"
                          bind:value={uploadCategory}
                        />
                      </Field.Field>
                      <Field.Field>
                        <Field.Label for="upload-role">Placement</Field.Label>
                        <Select.Root type="single" bind:value={uploadRole}>
                          <Select.Trigger id="upload-role" class="w-full">
                            <span>{uploadRole === 'ambience' ? 'Background' : 'Soundboard'}</span>
                          </Select.Trigger>
                          <Select.Content>
                            <Select.Group>
                              <Select.Item value="ambience">Background</Select.Item>
                              <Select.Item value="soundboard">Soundboard</Select.Item>
                            </Select.Group>
                          </Select.Content>
                        </Select.Root>
                      </Field.Field>
                    </div>
                    <Button type="submit" disabled={!uploadFile || busy !== null}>
                      {#if busy === 'upload'}
                        <Spinner data-icon="inline-start" />
                        Uploading
                      {:else}
                        <Upload data-icon="inline-start" />
                        Add MP3
                      {/if}
                    </Button>
                  </Field.Group>
                </form>
              </Tabs.Content>

              <Tabs.Content value="youtube">
                <form
                  class="pt-4"
                  onsubmit={(event) => {
                    event.preventDefault();
                    void addYouTubeAsset();
                  }}
                >
                  <Field.Group>
                    <Field.Field>
                      <Field.Label for="youtube-url">YouTube URL</Field.Label>
                      <Input
                        id="youtube-url"
                        type="url"
                        placeholder="https://youtube.com/watch?v=…"
                        bind:value={youtubeUrl}
                      />
                    </Field.Field>
                    <Field.Field>
                      <Field.Label id="youtube-mode-label">Storage type</Field.Label>
                      <ToggleGroup.Root
                        type="single"
                        variant="outline"
                        spacing={2}
                        class="w-full"
                        aria-labelledby="youtube-mode-label"
                        bind:value={youtubeMode}
                      >
                        <ToggleGroup.Item value="live" class="flex-1">
                          <Cloud />
                          Live stream
                        </ToggleGroup.Item>
                        <ToggleGroup.Item value="saved" class="flex-1">
                          <Download />
                          Save MP3
                        </ToggleGroup.Item>
                      </ToggleGroup.Root>
                      <Field.Description>
                        {youtubeMode === 'live'
                          ? 'Resolved and streamed each time it plays.'
                          : 'Downloaded once and played from local MP3 storage.'}
                      </Field.Description>
                    </Field.Field>
                    <Field.Field>
                      <Field.Label for="youtube-name">Display name (optional)</Field.Label>
                      <Input
                        id="youtube-name"
                        placeholder="Uses the YouTube title"
                        bind:value={youtubeName}
                      />
                    </Field.Field>
                    <div class="grid grid-cols-2 gap-3">
                      <Field.Field>
                        <Field.Label for="youtube-category">Category</Field.Label>
                        <Input
                          id="youtube-category"
                          placeholder="e.g. Taverns"
                          bind:value={youtubeCategory}
                        />
                      </Field.Field>
                      <Field.Field>
                        <Field.Label for="youtube-role">Placement</Field.Label>
                        <Select.Root type="single" bind:value={youtubeRole}>
                          <Select.Trigger id="youtube-role" class="w-full">
                            <span>{youtubeRole === 'ambience' ? 'Background' : 'Soundboard'}</span>
                          </Select.Trigger>
                          <Select.Content>
                            <Select.Group>
                              <Select.Item value="ambience">Background</Select.Item>
                              <Select.Item value="soundboard">Soundboard</Select.Item>
                            </Select.Group>
                          </Select.Content>
                        </Select.Root>
                      </Field.Field>
                    </div>
                    <Button type="submit" disabled={!youtubeUrl.trim() || busy !== null}>
                      {#if busy === 'youtube'}
                        <Spinner data-icon="inline-start" />
                        {youtubeMode === 'saved' ? 'Downloading' : 'Resolving'}
                      {:else if youtubeMode === 'saved'}
                        <Download data-icon="inline-start" />
                        Save to library
                      {:else}
                        <Cloud data-icon="inline-start" />
                        Add live stream
                      {/if}
                    </Button>
                  </Field.Group>
                </form>
              </Tabs.Content>
            </Tabs.Root>

            <Separator />

            <InputGroup.Root>
              <InputGroup.Addon><Search /></InputGroup.Addon>
              <InputGroup.Input
                aria-label="Search library"
                placeholder="Search library…"
                bind:value={librarySearch}
              />
            </InputGroup.Root>

            <div class="max-h-[calc(100vh-520px)] min-h-72 overflow-y-auto pr-1">
              {#if filteredAssets.length === 0}
                <Empty.Root>
                  <Empty.Header>
                    <Empty.Media variant="icon"><FileAudio /></Empty.Media>
                    <Empty.Title>
                      {appState.assets.length ? 'No matching audio' : 'Library is empty'}
                    </Empty.Title>
                    <Empty.Description>
                      {appState.assets.length
                        ? 'Try another search.'
                        : 'Upload an MP3 or add a YouTube item above.'}
                    </Empty.Description>
                  </Empty.Header>
                </Empty.Root>
              {:else}
                <div class="flex flex-col gap-1">
                  {#each filteredAssets as asset, index (asset.id)}
                    {#if index > 0}<Separator />{/if}
                    <article class="flex items-start gap-3 py-3">
                      <div
                        class="bg-muted text-muted-foreground grid size-9 shrink-0 place-items-center rounded-lg"
                      >
                        {#if asset.sourceType === 'youtube-live'}
                          <Cloud />
                        {:else if asset.sourceType === 'youtube-saved'}
                          <Download />
                        {:else}
                          <FileAudio />
                        {/if}
                      </div>
                      <div class="min-w-0 flex-1">
                        <p class="truncate text-sm font-semibold">{asset.name}</p>
                        <p class="text-muted-foreground mt-1 truncate text-xs">
                          {asset.category} · {sourceTypeLabel(asset.sourceType)}
                        </p>
                        <div class="mt-2 flex flex-wrap gap-1">
                          <Badge variant={asset.role === 'soundboard' ? 'secondary' : 'outline'}>
                            {asset.role === 'soundboard' ? 'Soundboard' : 'Background'}
                          </Badge>
                          <Badge variant="outline">{formatDuration(asset.duration)}</Badge>
                        </div>
                        <div class="mt-3 flex flex-wrap gap-1">
                          {#if asset.filename}
                            <Button variant="ghost" size="xs" onclick={() => preview(asset)}>
                              <Play data-icon="inline-start" />
                              Preview
                            </Button>
                          {:else if asset.youtubeUrl}
                            <Button
                              variant="ghost"
                              size="xs"
                              href={asset.youtubeUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <ExternalLink data-icon="inline-start" />
                              Open
                            </Button>
                          {/if}
                          <Button
                            variant="ghost"
                            size="xs"
                            disabled={busy !== null}
                            onclick={() =>
                              setAssetRole(
                                asset,
                                asset.role === 'soundboard' ? 'ambience' : 'soundboard'
                              )}
                          >
                            {#if asset.role === 'soundboard'}
                              <X data-icon="inline-start" />
                            {:else}
                              <Plus data-icon="inline-start" />
                            {/if}
                            {asset.role === 'soundboard' ? 'Remove button' : 'Add button'}
                          </Button>
                        </div>
                      </div>
                      <div class="flex shrink-0">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`Edit ${asset.name}`}
                          onclick={() => beginEdit(asset)}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`Delete ${asset.name}`}
                          onclick={() => beginDelete(asset)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </article>
                  {/each}
                </div>
              {/if}
            </div>
          </Card.Content>
        </Card.Root>
      </aside>
    </main>
  </div>
{/if}

<Dialog.Root bind:open={editOpen}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>Edit library item</Dialog.Title>
      <Dialog.Description
        >Change its label, category, or control-surface placement.</Dialog.Description
      >
    </Dialog.Header>
    <Field.Group>
      <Field.Field>
        <Field.Label for="edit-name">Display name</Field.Label>
        <Input id="edit-name" bind:value={editName} />
      </Field.Field>
      <Field.Field>
        <Field.Label for="edit-category">Category</Field.Label>
        <Input id="edit-category" bind:value={editCategory} />
      </Field.Field>
      <Field.Field>
        <Field.Label for="edit-role">Placement</Field.Label>
        <Select.Root type="single" bind:value={editRole}>
          <Select.Trigger id="edit-role" class="w-full">
            <span>{editRole === 'ambience' ? 'Background' : 'Soundboard'}</span>
          </Select.Trigger>
          <Select.Content>
            <Select.Group>
              <Select.Item value="ambience">Background</Select.Item>
              <Select.Item value="soundboard">Soundboard</Select.Item>
            </Select.Group>
          </Select.Content>
        </Select.Root>
      </Field.Field>
    </Field.Group>
    <Dialog.Footer>
      <Button variant="outline" onclick={() => (editOpen = false)}>Cancel</Button>
      <Button disabled={!editName.trim() || busy !== null} onclick={saveEdit}>
        {#if busy?.startsWith('edit-')}<Spinner data-icon="inline-start" />{/if}
        Save changes
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<AlertDialog.Root bind:open={deleteOpen}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Delete “{deletingAsset?.name}”?</AlertDialog.Title>
      <AlertDialog.Description>
        This removes the library entry and its saved MP3, if it has one. This cannot be undone.
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action
        variant="destructive"
        disabled={!deletingAsset || busy !== null}
        onclick={confirmDelete}
      >
        {#if busy?.startsWith('delete-')}<Spinner data-icon="inline-start" />{/if}
        Delete
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
