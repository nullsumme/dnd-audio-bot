import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { apiError } from '$lib/server/http';
import {
  SceneNotFoundError,
  type CreateSceneInput,
  type UpdateSceneInput
} from '$lib/server/scenes';
import { runtime } from '$lib/server/runtime';
import type { SceneCollection } from '$lib/types';
import { _validateSceneAssets } from '../+server';

const assetIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 'Asset ids contain invalid characters.');

const updateSceneSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
    trackIds: z.array(assetIdSchema).max(1_000).optional(),
    effectIds: z.array(assetIdSchema).max(1_000).optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one scene field to update.');

export function _parseUpdateSceneInput(value: unknown): UpdateSceneInput {
  return updateSceneSchema.parse(value);
}

export function _sceneAfterUpdate(
  current: SceneCollection,
  update: UpdateSceneInput
): CreateSceneInput {
  return {
    name: update.name ?? current.name,
    description: update.description ?? current.description,
    trackIds: update.trackIds ?? current.trackIds,
    effectIds: update.effectIds ?? current.effectIds
  };
}

function sceneApiError(cause: unknown): never {
  if (cause instanceof SceneNotFoundError) {
    throw error(404, { message: cause.message });
  }
  return apiError(cause);
}

export async function GET({ params }: { params: { id: string } }) {
  await runtime.initialize();
  const scene = runtime.scenes.get(params.id);
  if (!scene) throw error(404, { message: 'Scene not found.' });
  return json({ scene }, { headers: { 'cache-control': 'no-store' } });
}

export async function PATCH({ params, request }: { params: { id: string }; request: Request }) {
  try {
    await runtime.initialize();
    const input = _parseUpdateSceneInput(await request.json());
    const scene = await runtime.mutateCatalog(async () => {
      const current = runtime.scenes.get(params.id);
      if (!current) throw new SceneNotFoundError('Scene not found.');
      _validateSceneAssets(_sceneAfterUpdate(current, input), runtime.library.list());
      const updated = await runtime.scenes.update(params.id, input);
      await runtime.playback.reconcile();
      return updated;
    });
    runtime.activity.record('scene', 'update', `Updated scene ${scene.name}`);
    return json({ scene });
  } catch (cause) {
    return sceneApiError(cause);
  }
}

export async function DELETE({ params }: { params: { id: string } }) {
  try {
    await runtime.initialize();
    const scene = await runtime.mutateCatalog(async () => {
      const deleted = await runtime.scenes.delete(params.id);
      await runtime.playback.reconcile();
      return deleted;
    });
    runtime.activity.record('scene', 'delete', `Deleted scene ${scene.name}`);
    return json({ deleted: scene.id });
  } catch (cause) {
    return sceneApiError(cause);
  }
}
