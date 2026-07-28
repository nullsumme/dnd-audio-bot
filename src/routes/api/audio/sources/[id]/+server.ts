import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { apiError } from '$lib/server/http';
import { runtime } from '$lib/server/runtime';

const schema = z
  .object({
    volume: z.number().min(0).max(1).optional(),
    paused: z.boolean().optional(),
    positionMilliseconds: z.number().int().min(0).optional(),
    repeat: z.boolean().optional()
  })
  .strict()
  .refine(
    (input) =>
      input.volume !== undefined ||
      input.paused !== undefined ||
      input.positionMilliseconds !== undefined ||
      input.repeat !== undefined,
    'Provide at least one source property to update.'
  );

export function _parseSourcePatch(value: unknown) {
  return schema.parse(value);
}

export async function PATCH({ params, request }: { params: { id: string }; request: Request }) {
  try {
    const input = _parseSourcePatch(await request.json());
    if (input.paused === true) {
      runtime.engine.pause(params.id);
      runtime.activity.record('audio', 'pause', 'Paused background playback');
    }
    if (input.volume !== undefined) runtime.engine.setSourceVolume(params.id, input.volume);
    if (input.repeat !== undefined || input.positionMilliseconds !== undefined) {
      await runtime.engine.updateSourceTransport(params.id, {
        ...(input.repeat !== undefined ? { repeat: input.repeat } : {}),
        ...(input.positionMilliseconds !== undefined
          ? { positionMilliseconds: input.positionMilliseconds }
          : {})
      });
    }
    if (input.positionMilliseconds !== undefined) {
      runtime.activity.record('audio', 'seek', 'Changed the background playback position');
    }
    if (input.repeat !== undefined) {
      runtime.activity.record(
        'settings',
        'update',
        `${input.repeat ? 'Enabled' : 'Disabled'} track repeat`
      );
    }
    if (input.paused === false) {
      runtime.engine.resume(params.id);
      runtime.activity.record('audio', 'resume', 'Resumed background playback');
    }
    return json({ source: runtime.engine.getSource(params.id) });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE({ params }: { params: { id: string } }) {
  if (!runtime.engine.stop(params.id)) throw errorResponse();
  await runtime.playback.reconcile();
  runtime.activity.record('audio', 'stop', 'Stopped an active source');
  return json({ deleted: params.id });
}

function errorResponse(): never {
  return apiError(new Error('Active source not found.'));
}
