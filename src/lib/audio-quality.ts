export const DISCORD_BITRATE_MODES = ['auto', '64000', '96000', '128000', '384000'] as const;
export type DiscordBitrateMode = (typeof DISCORD_BITRATE_MODES)[number];

export const DISCORD_OPUS_MIN_BITRATE = 8_000;
export const DISCORD_OPUS_MAX_BITRATE = 384_000;
export const DEFAULT_DISCORD_BITRATE_MODE: DiscordBitrateMode = 'auto';

export function isDiscordBitrateMode(value: unknown): value is DiscordBitrateMode {
  return typeof value === 'string' && DISCORD_BITRATE_MODES.includes(value as DiscordBitrateMode);
}

export function resolveDiscordOpusBitrate(
  mode: DiscordBitrateMode,
  channelBitrate: number
): number {
  if (!Number.isSafeInteger(channelBitrate) || channelBitrate < DISCORD_OPUS_MIN_BITRATE) {
    throw new Error('Discord did not report a valid bitrate for this voice channel.');
  }
  const requested = mode === 'auto' ? DISCORD_OPUS_MAX_BITRATE : Number(mode);
  return Math.min(requested, channelBitrate);
}
