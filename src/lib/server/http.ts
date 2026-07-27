import { error, json } from '@sveltejs/kit';

export function apiError(cause: unknown, fallback = 'The request could not be completed.'): never {
  const message = cause instanceof Error ? cause.message : fallback;
  throw error(400, { message });
}

export function ok<T extends Record<string, unknown>>(body: T) {
  return json({ ok: true, ...body });
}
