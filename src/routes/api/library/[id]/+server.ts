import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { apiError } from '$lib/server/http';
import { runtime } from '$lib/server/runtime';

const updateSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    category: z.string().min(1).max(40).optional(),
    role: z.enum(['ambience', 'soundboard']).optional()
  })
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update.');

export async function PATCH({ params, request }: { params: { id: string }; request: Request }) {
  try {
    await runtime.initialize();
    const input = updateSchema.parse(await request.json());
    const asset = await runtime.library.update(params.id, input);
    if (asset.role === 'soundboard' && runtime.capabilities.ffmpeg) {
      void runtime.pcmCache.prepare(asset, runtime.library.filePath(asset));
    } else {
      runtime.pcmCache.remove(asset.id);
    }
    return json({ asset });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE({ params }: { params: { id: string } }) {
  try {
    await runtime.initialize();
    runtime.engine.stopByAsset(params.id);
    const asset = await runtime.library.delete(params.id);
    runtime.pcmCache.remove(asset.id);
    return json({ deleted: asset.id });
  } catch (error) {
    return apiError(error);
  }
}
