import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AudioAsset } from '$lib/types';
import { _ArtworkLimitError, _createArtworkResponse, _readArtworkBody } from './+server';

const directories: string[] = [];
const asset = {
  id: 'asset',
  name: 'Asset',
  category: 'Effects',
  role: 'soundboard',
  filename: 'asset.mp3',
  originalFilename: 'asset.mp3',
  mimeType: 'audio/mpeg',
  size: 999,
  duration: 1,
  subtitle: '',
  mood: '',
  icon: 'sparkles',
  artworkFilename: 'asset.png',
  artworkMimeType: 'image/png',
  artworkSize: 12,
  createdAt: '2026-07-28T00:00:00.000Z',
  updatedAt: '2026-07-28T00:00:00.000Z'
} satisfies AudioAsset;

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true }))
  );
});

describe('audio artwork responses', () => {
  it('reads a chunked body without exceeding the configured limit', async () => {
    const request = new Request('http://soundkeep.test/api/library/asset/artwork', {
      method: 'POST',
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(Uint8Array.from([1, 2]));
          controller.enqueue(Uint8Array.from([3, 4]));
          controller.close();
        }
      }),
      duplex: 'half'
    } as RequestInit);

    await expect(_readArtworkBody(request, 4)).resolves.toEqual(Uint8Array.from([1, 2, 3, 4]));
  });

  it('aborts a chunked artwork body at the configured limit', async () => {
    const request = new Request('http://soundkeep.test/api/library/asset/artwork', {
      method: 'POST',
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(Uint8Array.from([1, 2, 3]));
          controller.enqueue(Uint8Array.from([4, 5]));
          controller.close();
        }
      }),
      duplex: 'half'
    } as RequestInit);

    await expect(_readArtworkBody(request, 4)).rejects.toBeInstanceOf(_ArtworkLimitError);
  });

  it('serves artwork with a bounded private content type', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'soundkeep-artwork-route-'));
    directories.push(directory);
    const path = join(directory, 'asset.png');
    const bytes = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x49, 0x45, 0x4e, 0x44
    ]);
    await writeFile(path, bytes);

    const response = await _createArtworkResponse(path, asset);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it('refuses to follow artwork symlinks', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'soundkeep-artwork-route-'));
    directories.push(directory);
    const path = join(directory, 'asset.png');
    const link = join(directory, 'linked.png');
    await writeFile(path, Uint8Array.from([1, 2, 3]));
    await symlink(path, link);

    await expect(_createArtworkResponse(link, asset)).rejects.toMatchObject({ code: 'ELOOP' });
  });
});
