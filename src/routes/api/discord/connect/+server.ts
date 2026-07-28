import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { apiError } from '$lib/server/http';
import { runtime } from '$lib/server/runtime';

const schema = z.object({ channelId: z.string().regex(/^\d+$/) });

export async function POST({ request }: { request: Request }) {
  try {
    await runtime.initialize();
    const { channelId } = schema.parse(await request.json());
    const discord = await runtime.discord.connect(channelId);
    runtime.activity.record(
      'discord',
      'connect',
      `Connected to ${discord.guildName ?? 'Discord'} · ${discord.channelName ?? channelId}`
    );
    return json({ discord });
  } catch (error) {
    return apiError(error);
  }
}
