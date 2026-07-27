import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { apiError } from '$lib/server/http';
import { runtime } from '$lib/server/runtime';

const schema = z.object({ volume: z.number().min(0).max(1) });

export async function PATCH({ params, request }: { params: { id: string }; request: Request }) {
  try {
    const { volume } = schema.parse(await request.json());
    return json({ source: runtime.engine.setSourceVolume(params.id, volume) });
  } catch (error) {
    return apiError(error);
  }
}

export function DELETE({ params }: { params: { id: string } }) {
  if (!runtime.engine.stop(params.id)) throw errorResponse();
  return json({ deleted: params.id });
}

function errorResponse(): never {
  return apiError(new Error('Active source not found.'));
}
