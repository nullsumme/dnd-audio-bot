import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { apiError } from '$lib/server/http';
import { runtime } from '$lib/server/runtime';
import { inspectYouTube } from '$lib/server/youtube';

const schema = z.object({
  url: z.string().min(1),
  volume: z.number().min(0).max(1).optional()
});

export async function POST({ request }: { request: Request }) {
  try {
    await runtime.initialize();
    if (!runtime.capabilities.ytdlp) throw new Error('yt-dlp is not available on the server.');
    const input = schema.parse(await request.json());
    const metadata = await inspectYouTube(input.url);
    const source = runtime.engine.playYouTube({
      url: metadata.url,
      title: metadata.title,
      volume: input.volume
    });
    return json({ source, metadata }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
