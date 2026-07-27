import { json } from '@sveltejs/kit';
import { runtime } from '$lib/server/runtime';

export async function GET() {
  return json(await runtime.snapshot(), {
    headers: { 'cache-control': 'no-store' }
  });
}
