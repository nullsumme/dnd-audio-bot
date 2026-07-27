import { json } from '@sveltejs/kit';
import { runtime } from '$lib/server/runtime';

export function POST() {
  runtime.discord.disconnect();
  return json({ discord: runtime.discord.status() });
}
