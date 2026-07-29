import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { DISCORD_BITRATE_MODES, type DiscordBitrateMode } from '$lib/audio-quality';
import { apiError } from '$lib/server/http';
import { runtime } from '$lib/server/runtime';

const schema = z.object({ mode: z.enum(DISCORD_BITRATE_MODES) });

export function _parseDiscordBitrateMode(value: unknown) {
  return schema.parse(value).mode;
}

export function _formatDiscordBitrateMode(mode: DiscordBitrateMode) {
  return mode === 'auto' ? 'automatic' : `${Math.round(Number(mode) / 1_000)} kbps`;
}

export async function PATCH({ request }: { request: Request }) {
  try {
    const mode = _parseDiscordBitrateMode(await request.json());
    const discord = await runtime.setDiscordBitrateMode(mode);
    runtime.activity.record(
      'settings',
      'update',
      `Discord bitrate set to ${_formatDiscordBitrateMode(mode)}`
    );
    return json({ discord });
  } catch (error) {
    return apiError(error);
  }
}
