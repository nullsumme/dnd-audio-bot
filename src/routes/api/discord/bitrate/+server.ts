import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { DISCORD_BITRATE_MODES } from '$lib/audio-quality';
import { apiError } from '$lib/server/http';
import { runtime } from '$lib/server/runtime';

const schema = z.object({ mode: z.enum(DISCORD_BITRATE_MODES) });

export function _parseDiscordBitrateMode(value: unknown) {
  return schema.parse(value).mode;
}

export async function PATCH({ request }: { request: Request }) {
  try {
    const mode = _parseDiscordBitrateMode(await request.json());
    const discord = await runtime.setDiscordBitrateMode(mode);
    runtime.activity.record(
      'settings',
      'update',
      `Discord bitrate set to ${mode === 'auto' ? 'automatic' : `${mode} kbps`}`
    );
    return json({ discord });
  } catch (error) {
    return apiError(error);
  }
}
