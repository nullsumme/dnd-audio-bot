<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import {
    AudioLines,
    Bot,
    Hash,
    Library,
    Radio,
    RefreshCw,
    Settings,
    Users,
    WandSparkles
  } from '@lucide/svelte';
  import * as Alert from '$lib/components/ui/alert';
  import { Badge } from '$lib/components/ui/badge';
  import * as Breadcrumb from '$lib/components/ui/breadcrumb';
  import { Button } from '$lib/components/ui/button';
  import { Separator } from '$lib/components/ui/separator';
  import * as Sidebar from '$lib/components/ui/sidebar';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { Toaster } from '$lib/components/ui/sonner';
  import { provideSoundkeep } from '$lib/soundkeep-client.svelte';
  import TransportDock from '$lib/components/soundkeep/transport-dock.svelte';

  let { children } = $props();

  const soundkeep = provideSoundkeep();
  const navigation = [
    {
      title: 'Console',
      description: 'Live session control',
      href: '/',
      icon: AudioLines
    },
    {
      title: 'Library',
      description: 'Manage audio assets',
      href: '/library',
      icon: Library
    },
    {
      title: 'Settings',
      description: 'Voice and output',
      href: '/settings',
      icon: Settings
    }
  ];

  let pathname = $derived(page.url.pathname);
  let currentPage = $derived(navigation.find((item) => item.href === pathname) ?? navigation[0]);

  onMount(() => soundkeep.start());

  function bitrateLabel() {
    const diagnostics = soundkeep.state.discord.audioDiagnostics;
    if (diagnostics.bitrate !== null) return `${Math.round(diagnostics.bitrate / 1_000)} kbps`;
    if (diagnostics.bitrateMode === 'auto') return 'Auto bitrate';
    return `${Math.round(Number(diagnostics.bitrateMode) / 1_000)} kbps target`;
  }
</script>

<svelte:head>
  <title>{currentPage.title} · Soundkeep</title>
  <meta
    name="description"
    content="A desktop Discord background music and soundboard controller for tabletop sessions."
  />
</svelte:head>

<Sidebar.Provider>
  <Sidebar.Root variant="inset" collapsible="icon">
    <Sidebar.Header>
      <Sidebar.Menu>
        <Sidebar.MenuItem>
          <Sidebar.MenuButton size="lg" tooltipContent="Soundkeep">
            {#snippet child({ props })}
              <a href="/" {...props}>
                <span
                  class="bg-primary text-primary-foreground grid aspect-square size-8 place-items-center rounded-lg"
                >
                  <WandSparkles />
                </span>
                <span class="grid flex-1 text-left leading-tight">
                  <span class="truncate font-semibold">Soundkeep</span>
                  <span class="text-muted-foreground truncate text-xs">Game master audio</span>
                </span>
              </a>
            {/snippet}
          </Sidebar.MenuButton>
        </Sidebar.MenuItem>
      </Sidebar.Menu>
    </Sidebar.Header>

    <Sidebar.Content>
      <Sidebar.Group>
        <Sidebar.GroupLabel>Workspace</Sidebar.GroupLabel>
        <Sidebar.GroupContent>
          <Sidebar.Menu>
            {#each navigation as item (item.href)}
              <Sidebar.MenuItem>
                <Sidebar.MenuButton isActive={pathname === item.href} tooltipContent={item.title}>
                  {#snippet child({ props })}
                    <a href={item.href} {...props}>
                      <item.icon />
                      <span>{item.title}</span>
                    </a>
                  {/snippet}
                </Sidebar.MenuButton>
                {#if item.href === '/library' && soundkeep.state.assets.length > 0}
                  <Sidebar.MenuBadge>{soundkeep.state.assets.length}</Sidebar.MenuBadge>
                {/if}
              </Sidebar.MenuItem>
            {/each}
          </Sidebar.Menu>
        </Sidebar.GroupContent>
      </Sidebar.Group>
    </Sidebar.Content>

    <Sidebar.Footer>
      <Sidebar.Menu>
        <Sidebar.MenuItem>
          <Sidebar.MenuButton size="lg" tooltipContent="Discord voice status">
            <span class="bg-sidebar-accent grid aspect-square size-8 place-items-center rounded-lg">
              {#if soundkeep.state.discord.connected}<Radio />{:else}<Bot />{/if}
            </span>
            <span class="grid flex-1 text-left leading-tight">
              <span class="truncate text-sm font-medium">
                {soundkeep.state.discord.botName ?? 'Discord bot'}
              </span>
              <span class="text-muted-foreground truncate text-xs">
                {soundkeep.state.discord.connected
                  ? `#${soundkeep.state.discord.channelName}`
                  : 'Voice disconnected'}
              </span>
            </span>
          </Sidebar.MenuButton>
        </Sidebar.MenuItem>
      </Sidebar.Menu>
    </Sidebar.Footer>
    <Sidebar.Rail />
  </Sidebar.Root>

  <Sidebar.Inset data-app-shell class="min-h-0 pt-(--titlebar-height)">
    <header
      class="bg-background/90 flex h-12 shrink-0 items-center gap-2 border-b px-3 backdrop-blur md:px-4"
    >
      <Sidebar.Trigger class="-ml-1" />
      <Separator orientation="vertical" class="h-4" />
      <div class="min-w-0 flex-1">
        <Breadcrumb.Root>
          <Breadcrumb.List>
            <Breadcrumb.Item class="hidden sm:inline-flex">
              <Breadcrumb.Link href="/">Soundkeep</Breadcrumb.Link>
            </Breadcrumb.Item>
            <Breadcrumb.Separator class="hidden sm:block" />
            <Breadcrumb.Item>
              <Breadcrumb.Page>{currentPage.title}</Breadcrumb.Page>
            </Breadcrumb.Item>
          </Breadcrumb.List>
        </Breadcrumb.Root>
        <p class="text-muted-foreground mt-0.5 hidden truncate text-xs md:block">
          {currentPage.description}
        </p>
      </div>
      {#if soundkeep.state.discord.connected}
        <Badge variant="outline" class="hidden max-w-48 lg:inline-flex">
          <Hash />
          <span class="truncate">{soundkeep.state.discord.channelName}</span>
        </Badge>
        <Badge
          variant="outline"
          class="hidden lg:inline-flex"
          aria-label={`${soundkeep.state.discord.listenerCount} human listeners`}
        >
          <Users />
          {soundkeep.state.discord.listenerCount}
        </Badge>
      {/if}
      <Badge
        variant={soundkeep.state.discord.connected ? 'success' : 'outline'}
        aria-label={soundkeep.state.discord.connected ? 'Voice connected' : 'Voice offline'}
      >
        <Radio />
        <span class="hidden sm:inline">
          {soundkeep.state.discord.connected ? 'Voice connected' : 'Voice offline'}
        </span>
      </Badge>
      <Badge variant="outline" class="hidden xl:inline-flex">{bitrateLabel()}</Badge>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Refresh state"
        disabled={soundkeep.refreshing}
        onclick={() => soundkeep.refresh(false)}
      >
        <RefreshCw />
      </Button>
    </header>

    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {#if soundkeep.initialLoading}
        <div class="grid gap-3 p-3 md:grid-cols-2 md:p-4 xl:grid-cols-4">
          {#each Array(4) as _, index (index)}
            <Skeleton class="h-28 w-full rounded-xl" />
          {/each}
          <Skeleton class="h-[420px] w-full rounded-xl md:col-span-2 xl:col-span-3" />
          <Skeleton class="h-[420px] w-full rounded-xl" />
        </div>
      {:else}
        {#if soundkeep.stateError}
          <div class="px-3 pt-3 md:px-4">
            <Alert.Root variant="destructive">
              <Bot />
              <Alert.Title>Live state unavailable</Alert.Title>
              <Alert.Description>{soundkeep.stateError}</Alert.Description>
              <Alert.Action>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={soundkeep.refreshing}
                  onclick={() => soundkeep.refresh(false)}
                >
                  <RefreshCw data-icon="inline-start" />
                  Retry
                </Button>
              </Alert.Action>
            </Alert.Root>
          </div>
        {:else if soundkeep.setupNeedsAttention}
          <div class="px-3 pt-3 md:px-4">
            <Alert.Root variant={!soundkeep.state.discord.configured ? 'destructive' : 'default'}>
              <Bot />
              <Alert.Title>Server setup needs attention</Alert.Title>
              <Alert.Description>
                {#if !soundkeep.state.discord.configured}Discord token missing.
                {/if}
                {#if !soundkeep.state.capabilities.ffmpeg}FFmpeg is unavailable.
                {/if}
                {#if !soundkeep.state.capabilities.ffprobe}FFprobe is unavailable.
                {/if}
              </Alert.Description>
            </Alert.Root>
          </div>
        {/if}
        {@render children()}
      {/if}
    </div>

    <TransportDock />
  </Sidebar.Inset>
</Sidebar.Provider>

<Toaster richColors position="top-right" />
