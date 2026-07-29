import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { apiError } from '$lib/server/http';
import type { PlaybackUpdate } from '$lib/server/playback';
import { runtime } from '$lib/server/runtime';

const playbackPatchSchema = z
  .object({
    activeSceneId: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
      .nullable()
      .optional(),
    shuffle: z.boolean().optional(),
    repeatMode: z.enum(['off', 'all', 'one']).optional()
  })
  .strict()
  .refine(
    (input) =>
      input.activeSceneId !== undefined ||
      input.shuffle !== undefined ||
      input.repeatMode !== undefined,
    'Provide at least one playback setting to update.'
  );

export function _parsePlaybackPatch(value: unknown): PlaybackUpdate {
  return playbackPatchSchema.parse(value);
}

export async function GET() {
  await runtime.initialize();
  return json(
    { playback: runtime.playback.snapshot() },
    { headers: { 'cache-control': 'no-store' } }
  );
}

export async function PATCH({ request }: { request: Request }) {
  try {
    await runtime.initialize();
    const input = _parsePlaybackPatch(await request.json());
    const playback = await runtime.playback.update(input);
    runtime.activity.record('settings', 'update', 'Updated background playback settings');
    return json({ playback });
  } catch (cause) {
    return apiError(cause);
  }
}
