import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { error } from '@sveltejs/kit';
import { runtime } from '$lib/server/runtime';

export async function GET({ params }: { params: { id: string } }) {
  await runtime.initialize();
  const asset = runtime.library.get(params.id);
  if (!asset) throw error(404, 'Audio asset not found.');
  if (!asset.filename || !asset.mimeType) throw error(404, 'This asset is streamed from YouTube.');
  const stream = createReadStream(runtime.library.filePath(asset));
  const safeName = (asset.originalFilename ?? `${asset.name}.mp3`).replace(/["\\\r\n]/g, '_');
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    headers: {
      'content-type': 'audio/mpeg',
      'content-length': asset.size.toString(),
      'content-disposition': `inline; filename="${safeName}"`,
      'cache-control': 'private, max-age=3600'
    }
  });
}
