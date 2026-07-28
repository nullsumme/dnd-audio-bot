import { json } from '@sveltejs/kit';
import { apiError } from '$lib/server/http';
import { runtime } from '$lib/server/runtime';

export async function POST() {
  try {
    await runtime.initialize();
    const source = await runtime.playback.previous();
    runtime.activity.record(
      'audio',
      source ? 'play' : 'stop',
      source ? `Playing ${source.label}` : 'Reached the start of the background queue'
    );
    return json({ source, playback: runtime.playback.snapshot() });
  } catch (cause) {
    return apiError(cause);
  }
}
