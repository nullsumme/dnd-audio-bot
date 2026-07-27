export type AssetRole = 'ambience' | 'soundboard';
export type SourceOrigin = 'youtube' | 'library';
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
  origin: SourceOrigin;
  role: AssetRole;
  volume: number;
  state: SourceState;
  startedAt: string;
  assetId?: string;
  url?: string;
  error?: string;
}

export interface VoiceChannelSummary {
  id: string;
  guildId: string;
  name: string;
  position: number;
}

export interface GuildSummary {
  id: string;
  name: string;
  iconUrl: string | null;
  voiceChannels: VoiceChannelSummary[];
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
  error: string | null;
}

export interface ApplicationState {
  discord: DiscordStatus;
  guilds: GuildSummary[];
  sources: ActiveSource[];
  assets: AudioAsset[];
  masterVolume: number;
  capabilities: {
    ffmpeg: boolean;
    ffprobe: boolean;
    ytdlp: boolean;
  };
}
