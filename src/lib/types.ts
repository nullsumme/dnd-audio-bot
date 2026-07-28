import type { DiscordBitrateMode } from '$lib/audio-quality';
import type { AssetIcon, ArtworkMimeType } from '$lib/asset-metadata';

export type AssetRole = 'ambience' | 'soundboard';
export type SourceState = 'starting' | 'playing' | 'paused' | 'restarting' | 'failed';

export interface AudioAsset {
  id: string;
  name: string;
  category: string;
  role: AssetRole;
  filename: string;
  originalFilename: string;
  mimeType: 'audio/mpeg';
  size: number;
  duration: number | null;
  subtitle: string;
  mood: string;
  icon: AssetIcon;
  artworkFilename: string | null;
  artworkMimeType: ArtworkMimeType | null;
  artworkSize: number;
  createdAt: string;
  updatedAt: string;
}

export interface SceneCollection {
  id: string;
  name: string;
  description: string;
  trackIds: string[];
  effectIds: string[];
  createdAt: string;
  updatedAt: string;
}

export type ActivityCategory = 'discord' | 'audio' | 'library' | 'scene' | 'settings' | 'system';
export type ActivityAction =
  | 'connect'
  | 'disconnect'
  | 'play'
  | 'pause'
  | 'resume'
  | 'seek'
  | 'stop'
  | 'upload'
  | 'update'
  | 'delete'
  | 'error';

export interface ActivityEntry {
  readonly id: string;
  readonly category: ActivityCategory;
  readonly action: ActivityAction;
  readonly message: string;
  readonly createdAt: string;
}

export type RepeatMode = 'off' | 'all' | 'one';

export interface PlaybackState {
  activeSceneId: string | null;
  queue: string[];
  currentAssetId: string | null;
  shuffle: boolean;
  repeatMode: RepeatMode;
}

export interface ActiveSource {
  id: string;
  label: string;
  role: AssetRole;
  volume: number;
  state: SourceState;
  startedAt: string;
  duration: number | null;
  positionMilliseconds: number;
  repeat: boolean;
  assetId?: string;
  error?: string;
}

export interface VoiceChannelSummary {
  id: string;
  guildId: string;
  name: string;
  position: number;
  bitrate: number;
}

export interface GuildSummary {
  id: string;
  name: string;
  iconUrl: string | null;
  voiceChannels: VoiceChannelSummary[];
}

export interface PcmCacheStatus {
  enabled: boolean;
  entries: number;
  bytes: number;
  reservedBytes: number;
  maxBytes: number;
  maxEntryBytes: number;
  warming: number;
  hits: number;
  misses: number;
  evictions: number;
  failures: number;
  oversized: number;
}

export interface DiscordStatus {
  configured: boolean;
  ready: boolean;
  botName: string | null;
  botAvatarUrl: string | null;
  connected: boolean;
  guildId: string | null;
  guildName: string | null;
  channelId: string | null;
  channelName: string | null;
  playerState: 'idle' | 'buffering' | 'playing' | 'paused' | 'autopaused';
  listenerCount: number;
  playableConnections: number;
  subscribed: boolean;
  audioDiagnostics: {
    encoder: 'ffmpeg/libopus';
    bitrateMode: DiscordBitrateMode;
    bitrate: number | null;
    channelBitrate: number | null;
    bitrateReconfiguring: boolean;
    packetizationMilliseconds: number;
    missedFrames: number;
    fillerFrames: number;
    partialFramesDeferred: number;
    finalPartialFramesPadded: number;
    staleFramesDropped: number;
    playerPlaybackMilliseconds: number;
    resourcePlaybackMilliseconds: number;
  };
  error: string | null;
}

export interface ApplicationState {
  discord: DiscordStatus;
  guilds: GuildSummary[];
  sources: ActiveSource[];
  assets: AudioAsset[];
  scenes: SceneCollection[];
  activity: ActivityEntry[];
  playback: PlaybackState;
  masterVolume: number;
  pcmCache: PcmCacheStatus;
  capabilities: {
    ffmpeg: boolean;
    ffprobe: boolean;
  };
}
