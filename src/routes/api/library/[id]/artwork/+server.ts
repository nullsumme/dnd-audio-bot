import { constants as fsConstants } from 'node:fs';
import { open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { error, json } from '@sveltejs/kit';
import type { ArtworkMimeType } from '$lib/asset-metadata';
import { apiError } from '$lib/server/http';
import { runtime } from '$lib/server/runtime';
import type { AudioAsset } from '$lib/types';

function artworkMimeType(request: Request): ArtworkMimeType {
  const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (mediaType === 'image/png' || mediaType === 'image/jpeg') return mediaType;
  throw new Error('Artwork must be sent as image/png or image/jpeg.');
}

function contentLength(request: Request): number | null {
  const raw = request.headers.get('content-length');
  if (raw === null) return null;
  if (!/^\d+$/.test(raw)) throw new Error('The artwork length is invalid.');
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('The artwork length is invalid.');
  return value;
}

export class _ArtworkLimitError extends Error {}

export async function _readArtworkBody(request: Request, maxBytes: number): Promise<Uint8Array> {
  if (!request.body) throw new Error('Choose artwork to upload.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      if (result.value.byteLength === 0) continue;
      total += result.value.byteLength;
      if (total > maxBytes) {
        const cause = new _ArtworkLimitError('The artwork upload exceeds the configured limit.');
        await reader.cancel(cause).catch(() => undefined);
        throw cause;
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function _createArtworkResponse(path: string, asset: AudioAsset): Promise<Response> {
  let file: FileHandle | undefined;
  try {
    file = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const fileStat = await file.stat();
    if (!fileStat.isFile()) throw new Error('Audio artwork is not a regular file.');
    const bytes = new Uint8Array(fileStat.size);
    const { bytesRead } = await file.read(bytes, 0, fileStat.size, 0);
    if (bytesRead !== fileStat.size) throw new Error('Audio artwork ended unexpectedly.');
    return new Response(bytes, {
      headers: {
        'content-type': asset.artworkMimeType ?? 'application/octet-stream',
        'content-length': bytesRead.toString(),
        'cache-control': 'private, max-age=3600',
        'x-content-type-options': 'nosniff'
      }
    });
  } finally {
    await file?.close().catch(() => undefined);
  }
}

export async function GET({ params }: { params: { id: string } }) {
  await runtime.initialize();
  const asset = runtime.library.get(params.id);
  if (!asset) throw error(404, 'Audio asset not found.');
  const path = runtime.library.artworkPath(asset);
  if (!path) throw error(404, 'Audio artwork not found.');
  try {
    return await _createArtworkResponse(path, asset);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
      throw error(404, 'Audio artwork file not found.');
    }
    throw cause;
  }
}

export async function POST({ params, request }: { params: { id: string }; request: Request }) {
  try {
    await runtime.initialize();
    const length = contentLength(request);
    if (length !== null && length > runtime.library.maxArtworkBytes) {
      return json(
        {
          message: `Artwork must be ${Math.round(runtime.library.maxArtworkBytes / 1024 / 1024)} MB or smaller.`
        },
        { status: 413 }
      );
    }
    const bytes = await _readArtworkBody(request, runtime.library.maxArtworkBytes);
    const asset = await runtime.library.setArtwork(params.id, bytes, artworkMimeType(request));
    runtime.activity.record('library', 'update', `Updated artwork for ${asset.name}`);
    return json({ asset });
  } catch (cause) {
    if (cause instanceof _ArtworkLimitError) {
      throw error(413, { message: cause.message });
    }
    return apiError(cause);
  }
}

export async function DELETE({ params }: { params: { id: string } }) {
  try {
    await runtime.initialize();
    const asset = await runtime.library.removeArtwork(params.id);
    runtime.activity.record('library', 'update', `Removed artwork from ${asset.name}`);
    return json({ asset });
  } catch (cause) {
    return apiError(cause);
  }
}
