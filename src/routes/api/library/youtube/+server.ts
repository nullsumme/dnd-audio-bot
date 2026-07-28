import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { apiError } from '$lib/server/http';
import { runtime } from '$lib/server/runtime';
import { inspectYouTube } from '$lib/server/youtube';

const schema = z.object({
  url: z.string().min(1),
  mode: z.enum(['live', 'saved']),
  name: z.string().max(100).default(''),
  category: z.string().max(40).default(''),
  role: z.enum(['ambience', 'soundboard'])
});

export async function POST({ request }: { request: Request }) {
  try {
    await runtime.initialize();
    if (!runtime.capabilities.ytdlp) throw new Error('yt-dlp is not available on the server.');
    const input = schema.parse(await request.json());
    if (input.mode === 'saved' && !runtime.capabilities.ffmpeg) {
      throw new Error('FFmpeg is required to save YouTube audio as MP3.');
    }
    const metadata = await inspectYouTube(input.url);
    const asset = await runtime.library.addYouTube({
      metadata,
      mode: input.mode,
      name: input.name,
      category: input.category,
      role: input.role
    });
    return json({ asset }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
