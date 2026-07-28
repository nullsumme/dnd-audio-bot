import { constants as fsConstants } from 'node:fs';
import { open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { error } from '@sveltejs/kit';
import type { AudioAsset } from '$lib/types';
import { runtime } from '$lib/server/runtime';

interface ByteRange {
  start: number;
  end: number;
}

export function _parseByteRange(header: string | null, size: number): ByteRange | null | 'invalid' {
  if (header === null) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || size <= 0) return 'invalid';
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return 'invalid';

  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return 'invalid';
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }

  const start = Number(rawStart);
  const requestedEnd = rawEnd ? Number(rawEnd) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= size ||
    requestedEnd < start
  ) {
    return 'invalid';
  }
  return { start, end: Math.min(requestedEnd, size - 1) };
}

export async function _createAssetFileResponse(
  path: string,
  asset: AudioAsset,
  rangeHeader: string | null
): Promise<Response> {
  let file: FileHandle | undefined;
  try {
    file = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const fileStat = await file.stat();
    if (!fileStat.isFile()) throw new Error('Audio asset is not a regular file.');
    const range = _parseByteRange(rangeHeader, fileStat.size);
    const safeName = asset.originalFilename.replace(/["\\\r\n]/g, '_');
    const commonHeaders = {
      'content-type': 'audio/mpeg',
      'content-disposition': `inline; filename="${safeName}"`,
      'cache-control': 'private, max-age=3600',
      'accept-ranges': 'bytes',
      'x-content-type-options': 'nosniff'
    };

    if (range === 'invalid') {
      await file.close();
      return new Response(null, {
        status: 416,
        headers: { ...commonHeaders, 'content-range': `bytes */${fileStat.size}` }
      });
    }

    const start = range?.start ?? 0;
    const end = range?.end ?? Math.max(0, fileStat.size - 1);
    const length = fileStat.size === 0 ? 0 : end - start + 1;
    if (length === 0) {
      await file.close();
      return new Response(null, {
        status: range ? 206 : 200,
        headers: { ...commonHeaders, 'content-length': '0' }
      });
    }

    let position = start;
    let closed = false;
    const closeFile = async () => {
      if (closed) return;
      closed = true;
      await file?.close();
    };
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const requested = Math.min(64 * 1024, end - position + 1);
          const buffer = Buffer.allocUnsafe(requested);
          const { bytesRead } = await file!.read(buffer, 0, requested, position);
          if (bytesRead === 0) {
            controller.error(new Error('The audio asset ended before its declared size.'));
            await closeFile();
            return;
          }
          position += bytesRead;
          controller.enqueue(buffer.subarray(0, bytesRead));
          if (position > end) {
            controller.close();
            await closeFile();
          }
        } catch (cause) {
          controller.error(cause);
          await closeFile().catch(() => undefined);
        }
      },
      async cancel() {
        await closeFile();
      }
    });
    return new Response(stream, {
      status: range ? 206 : 200,
      headers: {
        ...commonHeaders,
        'content-length': length.toString(),
        ...(range ? { 'content-range': `bytes ${start}-${end}/${fileStat.size}` } : {})
      }
    });
  } catch (cause) {
    await file?.close().catch(() => undefined);
    throw cause;
  }
}

export async function GET({ params, request }: { params: { id: string }; request: Request }) {
  await runtime.initialize();
  const asset = runtime.library.get(params.id);
  if (!asset) throw error(404, 'Audio asset not found.');
  try {
    return await _createAssetFileResponse(
      runtime.library.filePath(asset),
      asset,
      request.headers.get('range')
    );
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
      throw error(404, 'Audio asset file not found.');
    }
    throw cause;
  }
}
