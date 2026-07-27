import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { apiError } from '$lib/server/http';
import { runtime } from '$lib/server/runtime';

const schema = z.object({ volume: z.number().min(0).max(1) });

export async function PATCH({ request }: { request: Request }) {
  try {
    const { volume } = schema.parse(await request.json());
    return json({ masterVolume: runtime.engine.setMasterVolume(volume) });
  } catch (error) {
    return apiError(error);
  }
}
