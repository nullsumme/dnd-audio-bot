import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { apiError } from '$lib/server/http';
import type { CreateSceneInput } from '$lib/server/scenes';
import { runtime } from '$lib/server/runtime';
import type { AssetRole } from '$lib/types';

const assetIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 'Asset ids contain invalid characters.');

const createSceneSchema = z
  .object({
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
    trackIds: z.array(assetIdSchema).max(1_000).default([]),
    effectIds: z.array(assetIdSchema).max(1_000).default([])
  })
  .strict()
  .refine(
    (value) => value.trackIds.length > 0 || value.effectIds.length > 0,
    'A scene must contain at least one background track or sound effect.'
  );

export interface SceneAssetSummary {
  id: string;
  role: AssetRole;
}

export function _parseCreateSceneInput(value: unknown): CreateSceneInput {
  return createSceneSchema.parse(value);
}

export function _validateSceneAssets(
  input: Pick<CreateSceneInput, 'trackIds' | 'effectIds'>,
  assets: readonly SceneAssetSummary[]
): void {
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  for (const id of input.trackIds ?? []) {
    const asset = assetsById.get(id);
    if (!asset) throw new Error(`Background asset "${id}" was not found.`);
    if (asset.role !== 'ambience') {
      throw new Error(`Asset "${id}" is not assigned to the background library.`);
    }
  }
  for (const id of input.effectIds ?? []) {
    const asset = assetsById.get(id);
    if (!asset) throw new Error(`Sound effect asset "${id}" was not found.`);
    if (asset.role !== 'soundboard') {
      throw new Error(`Asset "${id}" is not assigned to the soundboard.`);
    }
  }
}

export async function GET() {
  await runtime.initialize();
  return json({ scenes: runtime.scenes.list() }, { headers: { 'cache-control': 'no-store' } });
}

export async function POST({ request }: { request: Request }) {
  try {
    await runtime.initialize();
    const input = _parseCreateSceneInput(await request.json());
    const scene = await runtime.mutateCatalog(async () => {
      _validateSceneAssets(input, runtime.library.list());
      const created = await runtime.scenes.create(input);
      await runtime.playback.reconcile();
      return created;
    });
    runtime.activity.record('scene', 'update', `Created scene ${scene.name}`);
    return json({ scene }, { status: 201 });
  } catch (cause) {
    return apiError(cause);
  }
}
