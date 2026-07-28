import { json } from '@sveltejs/kit';
import { runtime } from '$lib/server/runtime';

export function POST() {
  const current = runtime.discord.status();
  runtime.discord.disconnect();
  runtime.activity.record(
    'discord',
    'disconnect',
    current.channelName ? `Disconnected from ${current.channelName}` : 'Disconnected from Discord'
  );
  return json({ discord: runtime.discord.status() });
}
