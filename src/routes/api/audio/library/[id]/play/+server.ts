import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { apiError } from '$lib/server/http';
import { runtime } from '$lib/server/runtime';

const schema = z.object({
  role: z.enum(['ambience', 'soundboard']).optional(),
  volume: z.number().min(0).max(1).optional()
});

export async function POST({ params, request }: { params: { id: string }; request: Request }) {
  try {
    await runtime.initialize();
    if (!runtime.capabilities.ffmpeg) throw new Error('FFmpeg is not available on the server.');
    const input = schema.parse(await request.json());
    const asset = runtime.library.get(params.id);
    if (!asset) throw new Error('Audio asset not found.');
    const role = input.role ?? asset.role;
    const source = runtime.engine.playAsset(
      asset,
      asset.filename ? runtime.library.filePath(asset) : null,
      role,
      input.volume
    );
    return json({ source }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
