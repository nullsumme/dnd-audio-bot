import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { apiError } from '$lib/server/http';
import { LibraryQuotaError, UploadBusyError, UploadLimitError } from '$lib/server/library';
import { runtime } from '$lib/server/runtime';

const uploadSchema = z.object({
  filename: z.string().min(1).max(180),
  name: z.string().max(100).default(''),
  category: z.string().max(40).default(''),
  role: z.enum(['ambience', 'soundboard'])
});

export function _parseUploadMetadata(url: URL) {
  return uploadSchema.parse({
    filename: url.searchParams.get('filename') ?? '',
    name: url.searchParams.get('name') ?? '',
    category: url.searchParams.get('category') ?? '',
    role: url.searchParams.get('role') ?? ''
  });
}

function contentLength(request: Request): number | undefined {
  const raw = request.headers.get('content-length');
  if (raw === null) return undefined;
  if (!/^\d+$/.test(raw)) throw new Error('The upload length is invalid.');
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error('The upload length is invalid.');
  return value;
}

export async function GET() {
  await runtime.initialize();
  return json({ assets: runtime.library.list() }, { headers: { 'cache-control': 'no-store' } });
}

export async function POST({ request, url }: { request: Request; url: URL }) {
  try {
    await runtime.initialize();
    const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
    if (mediaType !== 'audio/mpeg') throw new Error('Send the MP3 as an audio/mpeg request body.');
    if (!request.body) throw new Error('Choose an MP3 file to upload.');

    const fields = _parseUploadMetadata(url);
    const asset = await runtime.library.add({
      stream: request.body,
      contentLength: contentLength(request),
      originalFilename: fields.filename,
      name: fields.name,
      category: fields.category,
      role: fields.role
    });
    return json({ asset }, { status: 201 });
  } catch (cause) {
    if (request.body && !request.body.locked) {
      await request.body.cancel(cause).catch(() => undefined);
    }
    if (cause instanceof UploadLimitError) {
      throw error(413, { message: cause.message });
    }
    if (cause instanceof UploadBusyError) {
      throw error(429, { message: cause.message });
    }
    if (cause instanceof LibraryQuotaError) {
      throw error(507, { message: cause.message });
    }
    return apiError(cause);
  }
}
