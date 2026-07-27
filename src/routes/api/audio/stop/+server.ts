import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { apiError } from '$lib/server/http';
import { runtime } from '$lib/server/runtime';

const schema = z.object({ scope: z.enum(['ambience', 'soundboard', 'all']) });

export async function POST({ request }: { request: Request }) {
  try {
    const { scope } = schema.parse(await request.json());
    return json({ stopped: runtime.engine.stopScope(scope) });
  } catch (error) {
    return apiError(error);
  }
}
