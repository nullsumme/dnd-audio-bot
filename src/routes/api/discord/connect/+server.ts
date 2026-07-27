import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { apiError } from '$lib/server/http';
import { runtime } from '$lib/server/runtime';

const schema = z.object({ channelId: z.string().regex(/^\d+$/) });

export async function POST({ request }: { request: Request }) {
  try {
    await runtime.initialize();
    const { channelId } = schema.parse(await request.json());
    return json({ discord: await runtime.discord.connect(channelId) });
  } catch (error) {
    return apiError(error);
  }
}
