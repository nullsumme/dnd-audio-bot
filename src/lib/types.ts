import type { DiscordBitrateMode } from '$lib/audio-quality';

export type AssetRole = 'ambience' | 'soundboard';
export type SourceState = 'starting' | 'playing' | 'restarting' | 'failed';

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
  createdAt: string;
  updatedAt: string;
}

export interface ActiveSource {
  id: string;
  label: string;
  role: AssetRole;
  volume: number;
  state: SourceState;
  startedAt: string;
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
  masterVolume: number;
  pcmCache: PcmCacheStatus;
  capabilities: {
    ffmpeg: boolean;
    ffprobe: boolean;
  };
}
