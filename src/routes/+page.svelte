<script lang="ts">
  import { onMount } from 'svelte';
  import {
    AudioLines,
    Bot,
    CircleStop,
    CloudUpload,
    Disc3,
    ExternalLink,
    FileAudio,
    Headphones,
    Library,
    Link2,
    LoaderCircle,
    LogOut,
    Pencil,
    Play,
    Plus,
    Radio,
    RefreshCw,
    Save,
    Search,
    Sparkles,
    Trash2,
    Upload,
    Volume2,
    WandSparkles,
    X
  } from '@lucide/svelte';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Slider } from '$lib/components/ui/slider';
  import type { ApplicationState, AudioAsset } from '$lib/types';
  import { cn, formatBytes, formatDuration } from '$lib/utils';

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
  let notice = $state<{ kind: 'success' | 'error'; text: string } | null>(null);
  let selectedChannel = $state('');
  let youtubeUrl = $state('');
  let librarySearch = $state('');
  let uploadName = $state('');
  let uploadCategory = $state('');
  let uploadRole = $state<'ambience' | 'soundboard'>('soundboard');
  let uploadFile = $state<File | null>(null);
  let editingAssetId = $state<string | null>(null);
  let editName = $state('');
  let editCategory = $state('');
  let editRole = $state<'ambience' | 'soundboard'>('soundboard');
  let masterPercent = $state(80);
  let previewAudio: HTMLAudioElement | null = null;

  let activeAmbience = $derived(appState.sources.filter((source) => source.role === 'ambience'));
  let activeEffects = $derived(appState.sources.filter((source) => source.role === 'soundboard'));
  let filteredAssets = $derived(
    appState.assets.filter((asset) => {
      const query = librarySearch.trim().toLowerCase();
      return (
        !query ||
        asset.name.toLowerCase().includes(query) ||
        asset.category.toLowerCase().includes(query)
      );
    })
  );

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
    const body = (await response.json().catch(() => ({}))) as { message?: string } & T;
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
    } catch (error) {
      if (firstLoad) showError(error);
    } finally {
      refreshing = false;
      if (firstLoad) initialLoading = false;
    }
  }

  async function run(label: string, action: () => Promise<unknown>, success?: string) {
    busy = label;
    notice = null;
    try {
      await action();
      if (success) notice = { kind: 'success', text: success };
      await refresh(false);
    } catch (error) {
      showError(error);
    } finally {
      busy = null;
    }
  }

  function showError(error: unknown) {
    notice = {
      kind: 'error',
      text: error instanceof Error ? error.message : 'Something went wrong.'
    };
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
      'The table is now on air.'
    );
  }

  async function disconnect() {
    await run(
      'disconnect',
      () => request('/api/discord/disconnect', { method: 'POST', body: '{}' }),
      'Disconnected from voice.'
    );
  }

  async function addYouTube() {
    const url = youtubeUrl.trim();
    if (!url) return;
    await run(
      'youtube',
      () =>
        request('/api/audio/youtube', {
          method: 'POST',
          body: JSON.stringify({ url, volume: 0.65 })
        }),
      'YouTube ambience added to the mix.'
    );
    if (!notice || notice.kind === 'success') youtubeUrl = '';
  }

  async function playAsset(asset: AudioAsset, role = asset.role) {
    await run(
      `play-${asset.id}`,
      () =>
        request(`/api/audio/library/${asset.id}/play`, {
          method: 'POST',
          body: JSON.stringify({ role, volume: role === 'soundboard' ? 0.85 : 0.65 })
        }),
      role === 'soundboard' ? undefined : `${asset.name} added to the ambience mix.`
    );
  }

  async function stopSource(id: string) {
    await run(`stop-${id}`, () =>
      request(`/api/audio/sources/${id}`, { method: 'DELETE', body: '{}' })
    );
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
    if (!uploadFile) {
      notice = { kind: 'error', text: 'Choose an MP3 file first.' };
      return;
    }
    const form = new FormData();
    form.set('file', uploadFile);
    form.set('name', uploadName);
    form.set('category', uploadCategory);
    form.set('role', uploadRole);
    await run(
      'upload',
      () => request('/api/library', { method: 'POST', body: form }),
      `${uploadName || uploadFile.name} added to the library.`
    );
    if (!notice || notice.kind === 'success') {
      uploadFile = null;
      uploadName = '';
      uploadCategory = '';
      const input = document.querySelector<HTMLInputElement>('#audio-upload');
      if (input) input.value = '';
    }
  }

  function beginEdit(asset: AudioAsset) {
    editingAssetId = asset.id;
    editName = asset.name;
    editCategory = asset.category;
    editRole = asset.role;
  }

  async function saveAsset(id: string) {
    await run(
      `edit-${id}`,
      () =>
        request(`/api/library/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: editName, category: editCategory, role: editRole })
        }),
      'Library entry updated.'
    );
    if (!notice || notice.kind === 'success') editingAssetId = null;
  }

  async function deleteAsset(asset: AudioAsset) {
    if (!window.confirm(`Delete “${asset.name}” from the library?`)) return;
    await run(
      `delete-${asset.id}`,
      () => request(`/api/library/${asset.id}`, { method: 'DELETE', body: '{}' }),
      `${asset.name} deleted.`
    );
  }

  function preview(asset: AudioAsset) {
    previewAudio?.pause();
    previewAudio = new Audio(`/api/library/${asset.id}/file`);
    previewAudio.volume = 0.7;
    void previewAudio.play().catch(showError);
  }

  function soundboardGroups(assets: AudioAsset[]) {
    const groups = new Map<string, AudioAsset[]>();
    for (const asset of assets.filter((item) => item.role === 'soundboard')) {
      const existing = groups.get(asset.category) ?? [];
      existing.push(asset);
      groups.set(asset.category, existing);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }
</script>

<svelte:head>
  <title>Soundkeep · D&D audio control</title>
  <meta
    name="description"
    content="A self-hosted Discord ambience mixer and soundboard for tabletop sessions."
  />
</svelte:head>

{#if initialLoading}
  <div class="flex min-h-screen items-center justify-center">
    <div class="text-muted-foreground flex items-center gap-3 text-sm">
      <LoaderCircle class="text-primary size-5 animate-spin" />
      Opening the soundkeep…
    </div>
  </div>
{:else}
  <div class="mx-auto min-h-screen w-full max-w-[1720px] px-5 py-5 lg:px-7">
    <header
      class="border-border/60 mb-5 flex min-h-16 items-center justify-between rounded-2xl border bg-[#151814]/78 px-5 shadow-[0_18px_55px_-45px_black] backdrop-blur-xl"
    >
      <div class="flex items-center gap-3.5">
        <div
          class="border-primary/25 bg-primary/10 text-primary grid size-10 place-items-center rounded-xl border shadow-inner"
        >
          <WandSparkles class="size-5" />
        </div>
        <div>
          <div class="flex items-baseline gap-2.5">
            <h1 class="font-display text-xl font-semibold tracking-tight">Soundkeep</h1>
            <span
              class="text-muted-foreground hidden text-[10px] font-bold tracking-[0.2em] uppercase sm:inline"
              >Game master console</span
            >
          </div>
          <p class="text-muted-foreground text-xs">Shape the room without leaving the table.</p>
        </div>
      </div>

      <div class="flex items-center gap-3">
        <div class="text-muted-foreground hidden items-center gap-2 text-xs md:flex">
          {#if activeAmbience.length > 0}
            <div class="flex h-4 items-end gap-0.5" aria-label="Audio is playing">
              <span class="meter-bar bg-primary h-2 w-0.5 rounded-full"></span>
              <span class="meter-bar bg-primary h-3.5 w-0.5 rounded-full"></span>
              <span class="meter-bar bg-primary h-2.5 w-0.5 rounded-full"></span>
            </div>
            {activeAmbience.length} ambience {activeAmbience.length === 1 ? 'layer' : 'layers'}
          {:else}
            <AudioLines class="size-4" /> Mix is quiet
          {/if}
        </div>
        <div class="bg-border h-6 w-px"></div>
        <Badge
          variant={appState.discord.connected
            ? 'success'
            : appState.discord.ready
              ? 'warning'
              : 'outline'}
        >
          <span
            class:animate-pulse={appState.discord.connected}
            class="size-1.5 rounded-full bg-current"
          ></span>
          {appState.discord.connected
            ? `#${appState.discord.channelName}`
            : appState.discord.ready
              ? 'Bot ready'
              : 'Offline'}
        </Badge>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Refresh state"
          disabled={refreshing}
          onclick={() => refresh(false)}
        >
          <RefreshCw class={refreshing ? 'size-4 animate-spin' : 'size-4'} />
        </Button>
      </div>
    </header>

    {#if notice}
      <div
        class={cn(
          'mb-4 flex items-center justify-between rounded-xl border px-4 py-3 text-sm',
          notice.kind === 'success'
            ? 'border-emerald-400/20 bg-emerald-400/8 text-emerald-200'
            : 'border-red-400/20 bg-red-400/8 text-red-200'
        )}
      >
        <span>{notice.text}</span>
        <button class="cursor-pointer opacity-70 hover:opacity-100" onclick={() => (notice = null)}>
          <X class="size-4" />
        </button>
      </div>
    {/if}

    {#if !appState.discord.configured || !appState.capabilities.ffmpeg || !appState.capabilities.ytdlp}
      <div
        class="mb-4 grid gap-2 rounded-xl border border-amber-400/20 bg-amber-400/7 px-4 py-3 text-sm text-amber-100"
      >
        {#if !appState.discord.configured}
          <p>
            <strong>Discord token missing.</strong> Set <code>DISCORD_BOT_TOKEN</code> to bring the bot
            online.
          </p>
        {/if}
        {#if !appState.capabilities.ffmpeg}
          <p><strong>FFmpeg missing.</strong> Local audio decoding is unavailable.</p>
        {/if}
        {#if !appState.capabilities.ytdlp}
          <p><strong>yt-dlp missing.</strong> YouTube ambience is unavailable.</p>
        {/if}
      </div>
    {/if}

    <main class="grid grid-cols-1 gap-5 xl:grid-cols-[292px_minmax(0,1fr)_380px]">
      <aside class="grid content-start gap-5">
        <Card.Root>
          <Card.Header class="border-border/60 border-b pb-4">
            <div class="flex items-center justify-between">
              <div>
                <Card.Title class="flex items-center gap-2 text-base">
                  <Radio class="text-primary size-4" />
                  Voice room
                </Card.Title>
                <Card.Description>Where the mix is heard</Card.Description>
              </div>
              {#if appState.discord.botAvatarUrl}
                <img
                  class="border-border size-9 rounded-full border"
                  src={appState.discord.botAvatarUrl}
                  alt={appState.discord.botName ?? 'Discord bot'}
                />
              {:else}
                <div class="bg-secondary grid size-9 place-items-center rounded-full">
                  <Bot class="text-muted-foreground size-4" />
                </div>
              {/if}
            </div>
          </Card.Header>
          <Card.Content class="space-y-4 pt-4">
            {#if appState.discord.connected}
              <div class="rounded-xl border border-emerald-400/15 bg-emerald-400/7 p-3">
                <div class="mb-1 flex items-center gap-2 text-xs font-semibold text-emerald-300">
                  <Headphones class="size-3.5" /> Live in voice
                </div>
                <p class="truncate text-sm font-semibold">#{appState.discord.channelName}</p>
                <p class="text-muted-foreground truncate text-xs">{appState.discord.guildName}</p>
              </div>
              <Button
                variant="outline"
                class="w-full"
                disabled={busy !== null}
                onclick={disconnect}
              >
                <LogOut class="size-4" /> Disconnect
              </Button>
            {:else}
              <div class="space-y-2">
                <Label for="voice-channel">Voice channel</Label>
                <select
                  id="voice-channel"
                  class="border-input bg-background/55 focus:border-primary/60 h-10 w-full rounded-lg border px-3 text-sm outline-none"
                  bind:value={selectedChannel}
                  disabled={!appState.discord.ready}
                >
                  {#if appState.guilds.length === 0}
                    <option value="">No voice channels found</option>
                  {/if}
                  {#each appState.guilds as guild}
                    <optgroup label={guild.name}>
                      {#each guild.voiceChannels as channel}
                        <option value={channel.id}>#{channel.name}</option>
                      {/each}
                    </optgroup>
                  {/each}
                </select>
              </div>
              <Button
                class="w-full"
                disabled={!appState.discord.ready || !selectedChannel || busy !== null}
                onclick={connect}
              >
                {#if busy === 'connect'}
                  <LoaderCircle class="size-4 animate-spin" />
                {:else}
                  <Headphones class="size-4" />
                {/if}
                Join channel
              </Button>
            {/if}
            {#if appState.discord.error}
              <p class="text-xs leading-relaxed text-red-300">{appState.discord.error}</p>
            {/if}
          </Card.Content>
        </Card.Root>

        <Card.Root>
          <Card.Header class="pb-3">
            <Card.Title class="flex items-center justify-between text-base">
              <span class="flex items-center gap-2"
                ><Volume2 class="text-primary size-4" /> Master output</span
              >
              <span class="text-muted-foreground font-sans text-sm">{masterPercent}%</span>
            </Card.Title>
          </Card.Header>
          <Card.Content class="space-y-4">
            <Slider
              bind:value={masterPercent}
              aria-label="Master volume"
              onchange={changeMasterVolume}
            />
            <div class="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={activeAmbience.length === 0 || busy !== null}
                onclick={() => stopScope('ambience')}
              >
                <CircleStop class="size-3.5" /> Ambience
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={appState.sources.length === 0 || busy !== null}
                onclick={() => stopScope('all')}
              >
                <CircleStop class="size-3.5" /> Stop all
              </Button>
            </div>
          </Card.Content>
        </Card.Root>

        <Card.Root class="overflow-hidden">
          <div
            class="border-border/60 border-b bg-[linear-gradient(135deg,rgba(217,166,74,.11),rgba(82,105,69,.08))] p-5"
          >
            <Sparkles class="text-primary mb-3 size-5" />
            <h3 class="font-display text-base font-semibold">A good scene breathes</h3>
            <p class="text-muted-foreground mt-1 text-xs leading-relaxed">
              Layer rain under a tavern track, then fire effects without breaking either loop.
            </p>
          </div>
          <div class="divide-border/60 grid grid-cols-3 divide-x p-4 text-center">
            <div>
              <p class="text-lg font-semibold">{activeAmbience.length}</p>
              <p class="text-muted-foreground text-[10px] tracking-wide uppercase">Layers</p>
            </div>
            <div>
              <p class="text-lg font-semibold">{activeEffects.length}</p>
              <p class="text-muted-foreground text-[10px] tracking-wide uppercase">Effects</p>
            </div>
            <div>
              <p class="text-lg font-semibold">{appState.assets.length}</p>
              <p class="text-muted-foreground text-[10px] tracking-wide uppercase">Assets</p>
            </div>
          </div>
        </Card.Root>
      </aside>

      <section class="min-w-0 space-y-5">
        <Card.Root>
          <Card.Header class="border-border/60 border-b pb-4">
            <div class="flex items-center justify-between">
              <div>
                <Card.Title class="flex items-center gap-2">
                  <Disc3 class="text-primary size-5" />
                  Ambience mixer
                </Card.Title>
                <Card.Description>Long-running layers share one Discord output</Card.Description>
              </div>
              <Badge variant={activeAmbience.length > 0 ? 'success' : 'outline'}>
                {activeAmbience.length > 0 ? `${activeAmbience.length} active` : 'Standing by'}
              </Badge>
            </div>
          </Card.Header>
          <Card.Content class="pt-5">
            <form
              class="border-border/70 bg-background/35 mb-5 flex gap-2 rounded-xl border p-2"
              onsubmit={(event) => {
                event.preventDefault();
                void addYouTube();
              }}
            >
              <div
                class="grid size-10 shrink-0 place-items-center rounded-lg bg-red-400/10 text-red-300"
              >
                <Link2 class="size-4" />
              </div>
              <Input
                class="border-0 bg-transparent shadow-none focus:ring-0"
                placeholder="Paste a YouTube ambience URL…"
                bind:value={youtubeUrl}
                aria-label="YouTube URL"
              />
              <Button
                type="submit"
                disabled={!appState.discord.connected || !youtubeUrl.trim() || busy !== null}
              >
                {#if busy === 'youtube'}
                  <LoaderCircle class="size-4 animate-spin" />
                  Resolving
                {:else}
                  <Plus class="size-4" />
                  Add layer
                {/if}
              </Button>
            </form>

            {#if activeAmbience.length === 0}
              <div
                class="border-border bg-background/20 grid min-h-64 place-items-center rounded-xl border border-dashed p-8 text-center"
              >
                <div>
                  <div
                    class="border-border bg-secondary/70 mx-auto mb-4 grid size-12 place-items-center rounded-full border"
                  >
                    <AudioLines class="text-muted-foreground size-5" />
                  </div>
                  <h3 class="font-display text-lg font-semibold">The room is quiet</h3>
                  <p class="text-muted-foreground mx-auto mt-1 max-w-sm text-sm">
                    Paste a YouTube link above or start an ambience asset from the library.
                  </p>
                </div>
              </div>
            {:else}
              <div class="grid gap-3">
                {#each activeAmbience as source (source.id)}
                  <div
                    class="border-border/70 bg-background/30 grid grid-cols-[minmax(0,1fr)_minmax(160px,240px)_auto] items-center gap-5 rounded-xl border px-4 py-3.5"
                  >
                    <div class="flex min-w-0 items-center gap-3">
                      <div
                        class={cn(
                          'grid size-10 shrink-0 place-items-center rounded-lg',
                          source.origin === 'youtube'
                            ? 'bg-red-400/10 text-red-300'
                            : 'bg-primary/10 text-primary'
                        )}
                      >
                        {#if source.origin === 'youtube'}
                          <ExternalLink class="size-4" />
                        {:else}
                          <FileAudio class="size-4" />
                        {/if}
                      </div>
                      <div class="min-w-0">
                        <p class="truncate text-sm font-semibold">{source.label}</p>
                        <div class="mt-1 flex items-center gap-2">
                          <Badge variant={source.state === 'playing' ? 'success' : 'warning'}>
                            {source.state}
                          </Badge>
                          <span class="text-muted-foreground text-[11px]">{source.origin}</span>
                        </div>
                        {#if source.error}
                          <p class="mt-1 truncate text-[11px] text-red-300" title={source.error}>
                            {source.error}
                          </p>
                        {/if}
                      </div>
                    </div>
                    <div class="flex items-center gap-3">
                      <Volume2 class="text-muted-foreground size-3.5 shrink-0" />
                      <Slider
                        value={Math.round(source.volume * 100)}
                        aria-label={`Volume for ${source.label}`}
                        onchange={(event) => changeSourceVolume(source.id, event)}
                      />
                      <span class="text-muted-foreground w-8 text-right text-xs tabular-nums"
                        >{Math.round(source.volume * 100)}</span
                      >
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Stop ${source.label}`}
                      disabled={busy !== null}
                      onclick={() => stopSource(source.id)}
                    >
                      <X class="size-4" />
                    </Button>
                  </div>
                {/each}
              </div>
            {/if}
          </Card.Content>
        </Card.Root>

        <Card.Root>
          <Card.Header class="border-border/60 border-b pb-4">
            <div class="flex items-center justify-between">
              <div>
                <Card.Title class="flex items-center gap-2">
                  <AudioLines class="text-primary size-5" />
                  Soundboard
                </Card.Title>
                <Card.Description
                  >One-shot clips play over every active ambience layer</Card.Description
                >
              </div>
              {#if activeEffects.length > 0}
                <Button variant="ghost" size="sm" onclick={() => stopScope('soundboard')}>
                  <CircleStop class="size-3.5" /> Stop effects
                </Button>
              {/if}
            </div>
          </Card.Header>
          <Card.Content class="pt-5">
            {#if soundboardGroups(appState.assets).length === 0}
              <div class="border-border rounded-xl border border-dashed p-8 text-center">
                <p class="text-sm font-semibold">No soundboard clips yet</p>
                <p class="text-muted-foreground mt-1 text-xs">
                  Upload an MP3 and assign it to the soundboard.
                </p>
              </div>
            {:else}
              <div class="space-y-6">
                {#each soundboardGroups(appState.assets) as [category, assets]}
                  <div>
                    <div class="mb-2.5 flex items-center gap-2">
                      <span
                        class="text-muted-foreground text-xs font-bold tracking-[0.14em] uppercase"
                        >{category}</span
                      >
                      <div class="bg-border/70 h-px flex-1"></div>
                    </div>
                    <div class="grid grid-cols-2 gap-2.5 md:grid-cols-3 2xl:grid-cols-4">
                      {#each assets as asset (asset.id)}
                        <button
                          class="group border-border/75 bg-background/30 hover:border-primary/35 hover:bg-primary/6 flex min-h-20 cursor-pointer items-center gap-3 rounded-xl border p-3 text-left transition hover:-translate-y-0.5 disabled:pointer-events-none disabled:opacity-45"
                          disabled={!appState.discord.connected || busy !== null}
                          onclick={() => playAsset(asset, 'soundboard')}
                        >
                          <span
                            class="bg-secondary text-muted-foreground group-hover:bg-primary/15 group-hover:text-primary grid size-10 shrink-0 place-items-center rounded-lg transition"
                          >
                            {#if busy === `play-${asset.id}`}
                              <LoaderCircle class="size-4 animate-spin" />
                            {:else}
                              <Play class="size-4 fill-current" />
                            {/if}
                          </span>
                          <span class="min-w-0">
                            <span class="block truncate text-sm font-semibold">{asset.name}</span>
                            <span class="text-muted-foreground block text-[11px]"
                              >{formatDuration(asset.duration)}</span
                            >
                          </span>
                        </button>
                      {/each}
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </Card.Content>
        </Card.Root>
      </section>

      <aside class="min-w-0">
        <Card.Root class="xl:sticky xl:top-5">
          <Card.Header class="border-border/60 border-b pb-4">
            <div class="flex items-center justify-between">
              <div>
                <Card.Title class="flex items-center gap-2">
                  <Library class="text-primary size-5" />
                  Audio library
                </Card.Title>
                <Card.Description
                  >{appState.assets.length} saved MP3 {appState.assets.length === 1
                    ? 'asset'
                    : 'assets'}</Card.Description
                >
              </div>
              <Badge variant="outline"
                >{formatBytes(appState.assets.reduce((sum, asset) => sum + asset.size, 0))}</Badge
              >
            </div>
          </Card.Header>

          <div class="border-border/60 border-b p-4">
            <div class="border-primary/25 bg-primary/5 rounded-xl border border-dashed p-3.5">
              <div class="mb-3 flex items-center gap-2 text-sm font-semibold">
                <CloudUpload class="text-primary size-4" /> Add to the keep
              </div>
              <div class="grid gap-2.5">
                <label
                  for="audio-upload"
                  class="border-border bg-background/40 text-muted-foreground hover:border-primary/35 hover:text-foreground flex min-h-16 cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 text-xs transition"
                >
                  <Upload class="size-4" />
                  <span class="truncate">{uploadFile?.name ?? 'Choose an MP3 file'}</span>
                </label>
                <input
                  id="audio-upload"
                  class="sr-only"
                  type="file"
                  accept=".mp3,audio/mpeg"
                  onchange={(event) => {
                    uploadFile = (event.currentTarget as HTMLInputElement).files?.[0] ?? null;
                    if (uploadFile && !uploadName)
                      uploadName = uploadFile.name.replace(/\.mp3$/i, '');
                  }}
                />
                <div class="grid grid-cols-2 gap-2">
                  <Input
                    placeholder="Display name"
                    bind:value={uploadName}
                    aria-label="Display name"
                  />
                  <Input placeholder="Category" bind:value={uploadCategory} aria-label="Category" />
                </div>
                <div class="grid grid-cols-[1fr_auto] gap-2">
                  <select
                    class="border-input bg-background/55 focus:border-primary/60 h-10 rounded-lg border px-3 text-sm outline-none"
                    bind:value={uploadRole}
                    aria-label="Audio role"
                  >
                    <option value="soundboard">Soundboard clip</option>
                    <option value="ambience">Ambience loop</option>
                  </select>
                  <Button disabled={!uploadFile || busy !== null} onclick={uploadAsset}>
                    {#if busy === 'upload'}
                      <LoaderCircle class="size-4 animate-spin" />
                    {:else}
                      <Upload class="size-4" />
                    {/if}
                    Upload
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <div class="border-border/60 border-b p-4">
            <div class="relative">
              <Search
                class="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2"
              />
              <Input class="pl-9" placeholder="Search assets…" bind:value={librarySearch} />
            </div>
          </div>

          <Card.Content class="max-h-[calc(100vh-435px)] min-h-72 space-y-2 overflow-y-auto p-3">
            {#if filteredAssets.length === 0}
              <div class="grid min-h-52 place-items-center p-6 text-center">
                <div>
                  <FileAudio class="text-muted-foreground/50 mx-auto mb-3 size-7" />
                  <p class="text-sm font-semibold">
                    {appState.assets.length ? 'No matching assets' : 'Your library is empty'}
                  </p>
                  <p class="text-muted-foreground mt-1 text-xs">
                    {appState.assets.length
                      ? 'Try a different search.'
                      : 'Upload an MP3 to get started.'}
                  </p>
                </div>
              </div>
            {:else}
              {#each filteredAssets as asset (asset.id)}
                <div
                  class="bg-background/26 hover:border-border/70 rounded-xl border border-transparent p-3"
                >
                  {#if editingAssetId === asset.id}
                    <div class="grid gap-2">
                      <Input bind:value={editName} aria-label="Asset name" />
                      <div class="grid grid-cols-2 gap-2">
                        <Input bind:value={editCategory} aria-label="Asset category" />
                        <select
                          class="border-input bg-background/55 h-10 rounded-lg border px-2 text-xs"
                          bind:value={editRole}
                        >
                          <option value="soundboard">Soundboard</option>
                          <option value="ambience">Ambience</option>
                        </select>
                      </div>
                      <div class="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onclick={() => (editingAssetId = null)}>
                          Cancel
                        </Button>
                        <Button size="sm" onclick={() => saveAsset(asset.id)}>
                          <Save class="size-3.5" /> Save
                        </Button>
                      </div>
                    </div>
                  {:else}
                    <div class="flex items-start gap-3">
                      <button
                        class="bg-secondary text-muted-foreground hover:bg-primary/15 hover:text-primary grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg transition"
                        aria-label={`Preview ${asset.name}`}
                        onclick={() => preview(asset)}
                      >
                        <Play class="size-3.5 fill-current" />
                      </button>
                      <div class="min-w-0 flex-1">
                        <p class="truncate text-sm font-semibold">{asset.name}</p>
                        <div class="mt-1 flex items-center gap-1.5">
                          <Badge variant={asset.role === 'ambience' ? 'default' : 'secondary'}>
                            {asset.role}
                          </Badge>
                          <span class="text-muted-foreground truncate text-[11px]"
                            >{asset.category}</span
                          >
                          <span class="text-muted-foreground/50 text-[11px]">·</span>
                          <span class="text-muted-foreground text-[11px]"
                            >{formatDuration(asset.duration)}</span
                          >
                        </div>
                      </div>
                      <div class="flex shrink-0">
                        {#if asset.role === 'ambience'}
                          <Button
                            variant="ghost"
                            size="icon"
                            class="size-8"
                            aria-label={`Play ${asset.name} as ambience`}
                            disabled={!appState.discord.connected || busy !== null}
                            onclick={() => playAsset(asset, 'ambience')}
                          >
                            <Plus class="size-3.5" />
                          </Button>
                        {/if}
                        <Button
                          variant="ghost"
                          size="icon"
                          class="size-8"
                          aria-label={`Edit ${asset.name}`}
                          onclick={() => beginEdit(asset)}
                        >
                          <Pencil class="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          class="size-8 hover:text-red-300"
                          aria-label={`Delete ${asset.name}`}
                          disabled={busy !== null}
                          onclick={() => deleteAsset(asset)}
                        >
                          <Trash2 class="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  {/if}
                </div>
              {/each}
            {/if}
          </Card.Content>
        </Card.Root>
      </aside>
    </main>
  </div>
{/if}
