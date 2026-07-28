import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { apiError } from '$lib/server/http';
import { runtime } from '$lib/server/runtime';

const schema = z.object({ scope: z.enum(['ambience', 'soundboard', 'all']) });

export async function POST({ request }: { request: Request }) {
  try {
    const { scope } = schema.parse(await request.json());
    const stopped = runtime.engine.stopScope(scope);
    if (scope === 'ambience' || scope === 'all') await runtime.playback.reconcile();
    if (stopped > 0) {
      runtime.activity.record('audio', 'stop', `Stopped ${scope === 'all' ? 'all audio' : scope}`);
    }
    return json({ stopped });
  } catch (error) {
    return apiError(error);
  }
}
