import { json } from '@sveltejs/kit';
import { runtime } from '$lib/server/runtime';

export async function GET() {
  await runtime.initialize();
  const ready = runtime.isReady();
  return json(
    {
      status: ready ? 'ready' : 'not-ready',
      discord: runtime.discord.status(),
      capabilities: runtime.capabilities
    },
    {
      status: ready ? 200 : 503,
      headers: { 'cache-control': 'no-store' }
    }
  );
}
