import { resolve } from 'node:path';

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  discordToken: process.env.DISCORD_BOT_TOKEN?.trim() ?? '',
  dataDir: resolve(process.env.DATA_DIR?.trim() || './data'),
  ffmpegPath: process.env.FFMPEG_PATH?.trim() || 'ffmpeg',
  ffprobePath: process.env.FFPROBE_PATH?.trim() || 'ffprobe',
  ytdlpPath: process.env.YTDLP_PATH?.trim() || 'yt-dlp',
  ytdlpCookiesFile: process.env.YTDLP_COOKIES_FILE?.trim() || null,
  maxActiveSources: positiveInteger('MAX_ACTIVE_SOURCES', 16),
  maxUploadBytes: positiveInteger('MAX_UPLOAD_BYTES', 250 * 1024 * 1024)
} as const;
