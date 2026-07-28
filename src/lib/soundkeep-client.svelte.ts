import { getContext, setContext } from 'svelte';
import { toast } from 'svelte-sonner';
import type { AssetIcon } from '$lib/asset-metadata';
import type { DiscordBitrateMode } from '$lib/audio-quality';
import type {
  ApplicationState,
  AssetRole,
  AudioAsset,
  RepeatMode,
  SceneCollection
} from '$lib/types';

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
    listenerCount: 0,
    playableConnections: 0,
    subscribed: false,
    audioDiagnostics: {
      encoder: 'ffmpeg/libopus',
      bitrateMode: 'auto',
      bitrate: null,
      channelBitrate: null,
      bitrateReconfiguring: false,
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
  scenes: [],
  activity: [],
  playback: {
    activeSceneId: null,
    queue: [],
    currentAssetId: null,
    shuffle: false,
    repeatMode: 'off'
  },
  masterVolume: 0.8,
  pcmCache: {
    enabled: false,
    entries: 0,
    bytes: 0,
    reservedBytes: 0,
    maxBytes: 0,
    maxEntryBytes: 0,
    warming: 0,
    hits: 0,
    misses: 0,
    evictions: 0,
    failures: 0,
    oversized: 0
  },
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

  get activeScene() {
    return (
      this.state.scenes.find((scene) => scene.id === this.state.playback.activeSceneId) ?? null
    );
  }

  get visibleBackgroundAssets() {
    const ids = this.activeScene?.trackIds;
    if (!ids) return this.backgroundAssets;
    const assets = new Map(this.backgroundAssets.map((asset) => [asset.id, asset]));
    return ids.flatMap((id) => {
      const asset = assets.get(id);
      return asset ? [asset] : [];
    });
  }

  get visibleSoundboardAssets() {
    const ids = this.activeScene?.effectIds;
    if (!ids) return this.soundboardAssets;
    const assets = new Map(this.soundboardAssets.map((asset) => [asset.id, asset]));
    return ids.flatMap((id) => {
      const asset = assets.get(id);
      return asset ? [asset] : [];
    });
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

  async changeDiscordBitrate(mode: DiscordBitrateMode) {
    return this.run(
      'discord-bitrate',
      () =>
        this.request('/api/discord/bitrate', {
          method: 'PATCH',
          body: JSON.stringify({ mode })
        }),
      'Discord audio bitrate updated.'
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

  async changeSourceTransport(
    id: string,
    input: {
      paused?: boolean;
      positionMilliseconds?: number;
      repeat?: boolean;
    }
  ) {
    return this.run(`transport-${id}`, () =>
      this.request(`/api/audio/sources/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input)
      })
    );
  }

  async changeMasterVolume(volume: number) {
    await this.request('/api/audio/master', {
      method: 'PATCH',
      body: JSON.stringify({ volume })
    }).catch((error) => this.showError(error));
  }

  async uploadAsset(
    file: File,
    input: {
      name: string;
      category: string;
      role: AssetRole;
      subtitle?: string;
      mood?: string;
      icon?: AssetIcon;
    },
    displayName: string,
    showSuccess = true
  ) {
    const query = new URLSearchParams({
      filename: file.name,
      name: input.name,
      category: input.category,
      role: input.role
    });
    if (input.subtitle) query.set('subtitle', input.subtitle);
    if (input.mood) query.set('mood', input.mood);
    if (input.icon) query.set('icon', input.icon);
    return this.run(
      'upload',
      () =>
        this.request(`/api/library?${query}`, {
          method: 'POST',
          headers: { 'content-type': 'audio/mpeg' },
          body: file
        }),
      showSuccess ? `${displayName} was added to the library.` : undefined
    );
  }

  async updateAsset(
    asset: AudioAsset,
    input: Partial<Pick<AudioAsset, 'name' | 'category' | 'role' | 'subtitle' | 'mood' | 'icon'>>,
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

  async uploadArtwork(asset: AudioAsset, file: File) {
    return this.run(
      `artwork-${asset.id}`,
      () =>
        this.request(`/api/library/${asset.id}/artwork`, {
          method: 'POST',
          headers: { 'content-type': file.type },
          body: file
        }),
      `Artwork for ${asset.name} was updated.`
    );
  }

  async removeArtwork(asset: AudioAsset) {
    return this.run(
      `artwork-${asset.id}`,
      () =>
        this.request(`/api/library/${asset.id}/artwork`, {
          method: 'DELETE',
          body: '{}'
        }),
      `Artwork for ${asset.name} was removed.`
    );
  }

  async setActiveScene(activeSceneId: string | null) {
    return this.configurePlayback({ activeSceneId });
  }

  async configurePlayback(input: {
    activeSceneId?: string | null;
    shuffle?: boolean;
    repeatMode?: RepeatMode;
  }) {
    return this.run('playback-settings', () =>
      this.request('/api/playback', {
        method: 'PATCH',
        body: JSON.stringify(input)
      })
    );
  }

  async nextTrack() {
    return this.run('next-track', () =>
      this.request('/api/playback/next', { method: 'POST', body: '{}' })
    );
  }

  async previousTrack() {
    return this.run('previous-track', () =>
      this.request('/api/playback/previous', { method: 'POST', body: '{}' })
    );
  }

  async createScene(input: {
    name: string;
    description?: string;
    trackIds: string[];
    effectIds: string[];
  }) {
    return this.run(
      'create-scene',
      () =>
        this.request('/api/scenes', {
          method: 'POST',
          body: JSON.stringify(input)
        }),
      `${input.name} was created.`
    );
  }

  async updateScene(
    scene: SceneCollection,
    input: {
      name?: string;
      description?: string;
      trackIds?: string[];
      effectIds?: string[];
    }
  ) {
    return this.run(
      `edit-scene-${scene.id}`,
      () =>
        this.request(`/api/scenes/${scene.id}`, {
          method: 'PATCH',
          body: JSON.stringify(input)
        }),
      `${input.name ?? scene.name} was updated.`
    );
  }

  async deleteScene(scene: SceneCollection) {
    return this.run(
      `delete-scene-${scene.id}`,
      () =>
        this.request(`/api/scenes/${scene.id}`, {
          method: 'DELETE',
          body: '{}'
        }),
      `${scene.name} was deleted.`
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
    for (const asset of this.visibleSoundboardAssets) {
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
