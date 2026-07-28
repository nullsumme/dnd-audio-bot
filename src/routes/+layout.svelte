<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import {
    AudioLines,
    Bot,
    Library,
    Radio,
    RefreshCw,
    Settings,
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

      <Sidebar.Group class="mt-auto">
        <Sidebar.GroupLabel>Session</Sidebar.GroupLabel>
        <Sidebar.GroupContent>
          <div class="flex flex-col gap-3 px-2 py-2 group-data-[collapsible=icon]:hidden">
            <div class="flex items-center justify-between gap-3">
              <span class="text-muted-foreground text-xs">Background</span>
              <Badge variant={soundkeep.backgroundSource ? 'success' : 'outline'}>
                {soundkeep.backgroundSource ? 'Playing' : 'Idle'}
              </Badge>
            </div>
            <div class="flex items-center justify-between gap-3">
              <span class="text-muted-foreground text-xs">Soundboard</span>
              <Badge variant={soundkeep.soundboardSource ? 'secondary' : 'outline'}>
                {soundkeep.soundboardSource ? 'Playing' : 'Idle'}
              </Badge>
            </div>
          </div>
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

  <Sidebar.Inset>
    <header
      class="bg-background/90 sticky top-0 flex h-14 shrink-0 items-center gap-3 border-b px-4 backdrop-blur md:px-6"
    >
      <Sidebar.Trigger class="-ml-1" />
      <Separator orientation="vertical" class="h-4" />
      <Breadcrumb.Root class="min-w-0 flex-1">
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
      <Badge variant={soundkeep.state.discord.connected ? 'success' : 'outline'}>
        {soundkeep.state.discord.connected ? 'Voice connected' : 'Voice offline'}
      </Badge>
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

    <div class="flex flex-1 flex-col">
      {#if soundkeep.initialLoading}
        <div class="grid gap-4 p-4 md:grid-cols-2 md:p-6 xl:grid-cols-4">
          {#each Array(4) as _, index (index)}
            <Skeleton class="h-28 w-full rounded-xl" />
          {/each}
          <Skeleton class="h-[420px] w-full rounded-xl md:col-span-2 xl:col-span-3" />
          <Skeleton class="h-[420px] w-full rounded-xl" />
        </div>
      {:else}
        {#if soundkeep.setupNeedsAttention}
          <div class="px-4 pt-4 md:px-6 md:pt-6">
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
                {#if !soundkeep.state.capabilities.ytdlp}yt-dlp is unavailable.{/if}
              </Alert.Description>
            </Alert.Root>
          </div>
        {/if}
        {@render children()}
      {/if}
    </div>
  </Sidebar.Inset>
</Sidebar.Provider>

<Toaster richColors position="top-right" />
