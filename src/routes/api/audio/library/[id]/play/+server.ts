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
  return requested ?? assetRole;
}

export async function POST({ params, request }: { params: { id: string }; request: Request }) {
  try {
    await runtime.initialize();
    if (!runtime.capabilities.ffmpeg) throw new Error('FFmpeg is not available on the server.');
    const input = schema.parse(await request.json());
    const asset = runtime.library.get(params.id);
    if (!asset) throw new Error('Audio asset not found.');
    const role = _resolvePlaybackRole(asset.role, input.role);
    const path = runtime.library.filePath(asset);
    const pcm =
      role === 'soundboard' && asset.role === 'soundboard'
        ? await runtime.pcmCache.getOrPrepare(asset, path)
        : null;
    const source = runtime.engine.playAsset(asset, path, role, input.volume, pcm);
    return json({ source }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
