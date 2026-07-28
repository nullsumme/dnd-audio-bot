import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { ASSET_ICONS } from '$lib/asset-metadata';
import { apiError } from '$lib/server/http';
import { runtime } from '$lib/server/runtime';

const updateSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    category: z.string().min(1).max(40).optional(),
    role: z.enum(['ambience', 'soundboard']).optional(),
    subtitle: z.string().max(100).optional(),
    mood: z.string().max(60).optional(),
    icon: z.enum(ASSET_ICONS).optional()
  })
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update.');

export async function PATCH({ params, request }: { params: { id: string }; request: Request }) {
  try {
    await runtime.initialize();
    const input = updateSchema.parse(await request.json());
    const asset = await runtime.mutateCatalog(async () => {
      const previous = runtime.library.get(params.id);
      const updated = await runtime.library.update(params.id, input);
      if (previous && previous.role !== updated.role) {
        await runtime.scenes.removeAssetReferences(updated.id);
      }
      await runtime.playback.reconcile();
      if (updated.role === 'soundboard' && runtime.capabilities.ffmpeg) {
        void runtime.pcmCache.prepare(updated, runtime.library.filePath(updated));
      } else {
        runtime.pcmCache.remove(updated.id);
      }
      return updated;
    });
    runtime.activity.record('library', 'update', `Updated ${asset.name}`);
    return json({ asset });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE({ params }: { params: { id: string } }) {
  try {
    await runtime.initialize();
    const asset = await runtime.mutateCatalog(async () => {
      runtime.engine.stopByAsset(params.id);
      const deleted = await runtime.library.delete(params.id);
      await runtime.scenes.removeAssetReferences(deleted.id);
      await runtime.playback.reconcile();
      runtime.pcmCache.remove(deleted.id);
      return deleted;
    });
    runtime.activity.record('library', 'delete', `Deleted ${asset.name}`);
    return json({ deleted: asset.id });
  } catch (error) {
    return apiError(error);
  }
}
