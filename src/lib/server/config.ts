import { resolve } from 'node:path';
import { DEFAULT_DISCORD_BITRATE_MODE, isDiscordBitrateMode } from '$lib/audio-quality';

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function discordBitrateMode() {
  const value = process.env.DISCORD_OPUS_BITRATE_MODE?.trim().toLowerCase();
  return isDiscordBitrateMode(value) ? value : DEFAULT_DISCORD_BITRATE_MODE;
}

export const config = {
  discordToken: process.env.DISCORD_BOT_TOKEN?.trim() ?? '',
  discordOpusBitrateMode: discordBitrateMode(),
  dataDir: resolve(process.env.DATA_DIR?.trim() || './data'),
  ffmpegPath: process.env.FFMPEG_PATH?.trim() || 'ffmpeg',
  ffprobePath: process.env.FFPROBE_PATH?.trim() || 'ffprobe',
  maxUploadBytes: positiveInteger('MAX_UPLOAD_BYTES', 250 * 1024 * 1024),
  maxLibraryBytes: positiveInteger('MAX_LIBRARY_BYTES', 8 * 1024 * 1024 * 1024),
  minFreeBytes: positiveInteger('MIN_FREE_BYTES', 256 * 1024 * 1024),
  maxConcurrentUploads: positiveInteger('MAX_CONCURRENT_UPLOADS', 1),
  maxPcmCacheBytes: nonNegativeInteger('MAX_PCM_CACHE_BYTES', 64 * 1024 * 1024),
  maxPcmCacheEntryBytes: nonNegativeInteger('MAX_PCM_CACHE_ENTRY_BYTES', 32 * 1024 * 1024)
} as const;
