import { getContext, setContext } from 'svelte';
import { toast } from 'svelte-sonner';
import type { ApplicationState, AssetRole, AudioAsset } from '$lib/types';

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
      packetizationMilliseconds: 20,
      missedFrames: 0,
      fillerFrames: 0,
      partialFramesDeferred: 0,
      finalPartialFramesPadded: 0,
      staleFramesDropped: 0,
      playerPlaybackMilliseconds: 0,
      resourcePlaybackMilliseconds: 0
    },
    error: null
  },
  guilds: [],
  sources: [],
  assets: [],
  masterVolume: 0.8,
  capabilities: { ffmpeg: false, ffprobe: false }
};

export class SoundkeepClient {
  state = $state<ApplicationState>(emptyState);
  initialLoading = $state(true);
  refreshing = $state(false);
  busy = $state<string | null>(null);

  #interval: number | null = null;
  #previewAudio: HTMLAudioElement | null = null;

  get backgroundSource() {
    return this.state.sources.find((source) => source.role === 'ambience') ?? null;
  }

  get soundboardSource() {
    return this.state.sources.find((source) => source.role === 'soundboard') ?? null;
  }

  get backgroundAssets() {
    return this.state.assets.filter((asset) => asset.role === 'ambience');
  }

  get soundboardAssets() {
    return this.state.assets.filter((asset) => asset.role === 'soundboard');
  }

  get totalLocalBytes() {
    return this.state.assets.reduce((total, asset) => total + asset.size, 0);
  }

  get setupNeedsAttention() {
    return (
      !this.state.discord.configured ||
      !this.state.capabilities.ffmpeg ||
      !this.state.capabilities.ffprobe
    );
  }

  start() {
    void this.refresh(true);
    this.#interval = window.setInterval(() => void this.refresh(false), 2_500);
    return () => {
      if (this.#interval !== null) window.clearInterval(this.#interval);
      this.#previewAudio?.pause();
    };
  }

  async request<T>(url: string, init?: RequestInit): Promise<T> {
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

  async refresh(firstLoad = false) {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      this.state = await this.request<ApplicationState>('/api/state');
    } catch (error) {
      if (firstLoad) this.showError(error);
    } finally {
      this.refreshing = false;
      if (firstLoad) this.initialLoading = false;
    }
  }

  async run(label: string, action: () => Promise<unknown>, success?: string) {
    this.busy = label;
    try {
      await action();
      await this.refresh(false);
      if (success) toast.success(success);
      return true;
    } catch (error) {
      this.showError(error);
      return false;
    } finally {
      this.busy = null;
    }
  }

  showError(error: unknown) {
    toast.error(error instanceof Error ? error.message : 'Something went wrong.');
  }

  async connect(channelId: string) {
    if (!channelId) return false;
    return this.run(
      'connect',
      () =>
        this.request('/api/discord/connect', {
          method: 'POST',
          body: JSON.stringify({ channelId })
        }),
      'Connected to the voice channel.'
    );
  }

  async disconnect() {
    return this.run(
      'disconnect',
      () => this.request('/api/discord/disconnect', { method: 'POST', body: '{}' }),
      'Disconnected from Discord voice.'
    );
  }

  async playAsset(asset: AudioAsset, role: AssetRole) {
    return this.run(
      `play-${role}-${asset.id}`,
      () =>
        this.request(`/api/audio/library/${asset.id}/play`, {
          method: 'POST',
          body: JSON.stringify({ role, volume: role === 'ambience' ? 0.65 : 0.85 })
        }),
      role === 'ambience' ? `${asset.name} is now the background.` : undefined
    );
  }

  async stopScope(scope: AssetRole | 'all') {
    return this.run(`stop-${scope}`, () =>
      this.request('/api/audio/stop', {
        method: 'POST',
        body: JSON.stringify({ scope })
      })
    );
  }

  async changeSourceVolume(id: string, volume: number) {
    await this.request(`/api/audio/sources/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ volume })
    }).catch((error) => this.showError(error));
  }

  async changeMasterVolume(volume: number) {
    await this.request('/api/audio/master', {
      method: 'PATCH',
      body: JSON.stringify({ volume })
    }).catch((error) => this.showError(error));
  }

  async uploadAsset(
    file: File,
    input: { name: string; category: string; role: AssetRole },
    displayName: string
  ) {
    const query = new URLSearchParams({
      filename: file.name,
      name: input.name,
      category: input.category,
      role: input.role
    });
    return this.run(
      'upload',
      () =>
        this.request(`/api/library?${query}`, {
          method: 'POST',
          headers: { 'content-type': 'audio/mpeg' },
          body: file
        }),
      `${displayName} was added to the library.`
    );
  }

  async updateAsset(
    asset: AudioAsset,
    input: Partial<Pick<AudioAsset, 'name' | 'category' | 'role'>>,
    success?: string
  ) {
    return this.run(
      `edit-${asset.id}`,
      () =>
        this.request(`/api/library/${asset.id}`, {
          method: 'PATCH',
          body: JSON.stringify(input)
        }),
      success
    );
  }

  async setAssetRole(asset: AudioAsset, role: AssetRole) {
    return this.run(
      `role-${asset.id}`,
      () =>
        this.request(`/api/library/${asset.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ role })
        }),
      role === 'soundboard'
        ? `${asset.name} was added to the soundboard.`
        : `${asset.name} was removed from the soundboard.`
    );
  }

  async deleteAsset(asset: AudioAsset) {
    return this.run(
      `delete-${asset.id}`,
      () => this.request(`/api/library/${asset.id}`, { method: 'DELETE', body: '{}' }),
      `${asset.name} was deleted from the library.`
    );
  }

  preview(asset: AudioAsset) {
    this.#previewAudio?.pause();
    this.#previewAudio = new Audio(`/api/library/${asset.id}/file`);
    this.#previewAudio.volume = 0.7;
    void this.#previewAudio.play().catch((error) => this.showError(error));
  }

  channelLabel(id: string): string {
    for (const guild of this.state.guilds) {
      const channel = guild.voiceChannels.find((item) => item.id === id);
      if (channel) return `${guild.name} · ${channel.name}`;
    }
    return 'Choose a voice channel';
  }

  soundboardGroups(): Array<[string, AudioAsset[]]> {
    const groups = new Map<string, AudioAsset[]>();
    for (const asset of this.soundboardAssets) {
      groups.set(asset.category, [...(groups.get(asset.category) ?? []), asset]);
    }
    return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
  }
}

const soundkeepContext = Symbol('soundkeep');

export function provideSoundkeep() {
  const client = new SoundkeepClient();
  setContext(soundkeepContext, client);
  return client;
}

export function useSoundkeep() {
  return getContext<SoundkeepClient>(soundkeepContext);
}
