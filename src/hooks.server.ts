import type { ServerInit } from '@sveltejs/kit';
import { runtime } from '$lib/server/runtime';

export const init: ServerInit = async () => {
  await runtime.initialize();
};

process.on('sveltekit:shutdown', async () => {
  await runtime.shutdown();
});
