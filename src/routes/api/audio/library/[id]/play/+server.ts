import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { apiError } from '$lib/server/http';
import { runtime } from '$lib/server/runtime';

const schema = z.object({
  role: z.enum(['ambience', 'soundboard']).optional(),
  volume: z.number().min(0).max(1).optional()
});

export function _resolvePlaybackRole(
  assetRole: 'ambience' | 'soundboard',
  requested?: 'ambience' | 'soundboard'
) {
  if (requested !== undefined && requested !== assetRole) {
    throw new Error('Playback placement must match the asset library placement.');
  }
  return assetRole;
}

export async function POST({ params, request }: { params: { id: string }; request: Request }) {
  try {
    await runtime.initialize();
    if (!runtime.capabilities.ffmpeg) throw new Error('FFmpeg is not available on the server.');
    const input = schema.parse(await request.json());
    const asset = runtime.library.get(params.id);
    if (!asset) throw new Error('Audio asset not found.');
    const role = _resolvePlaybackRole(asset.role, input.role);
    const source =
      role === 'ambience'
        ? await runtime.playback.play(asset, input.volume ?? 0.65)
        : runtime.engine.playAsset(
            asset,
            runtime.library.filePath(asset),
            role,
            input.volume,
            asset.role === 'soundboard'
              ? await runtime.pcmCache.getOrPrepare(asset, runtime.library.filePath(asset))
              : null
          );
    runtime.activity.record(
      'audio',
      'play',
      `${role === 'ambience' ? 'Started' : 'Played'} ${asset.name}`
    );
    return json({ source }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
