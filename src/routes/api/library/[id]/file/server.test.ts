import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AudioAsset } from '$lib/types';
import { _createAssetFileResponse, _parseByteRange } from './+server';

const directories: string[] = [];
const asset: AudioAsset = {
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
  artworkFilename: null,
  artworkMimeType: null,
  artworkSize: 0,
  createdAt: '2026-07-28T00:00:00.000Z',
  updatedAt: '2026-07-28T00:00:00.000Z'
};

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true }))
  );
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'soundkeep-file-route-'));
  directories.push(directory);
  const path = join(directory, 'asset.mp3');
  await writeFile(
    path,
    Uint8Array.from({ length: 10 }, (_, index) => index)
  );
  return { directory, path };
}

describe('audio asset file responses', () => {
  it('parses bounded, open-ended and suffix byte ranges', () => {
    expect(_parseByteRange(null, 10)).toBeNull();
    expect(_parseByteRange('bytes=2-5', 10)).toEqual({ start: 2, end: 5 });
    expect(_parseByteRange('bytes=7-', 10)).toEqual({ start: 7, end: 9 });
    expect(_parseByteRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 });
    expect(_parseByteRange('bytes=10-', 10)).toBe('invalid');
    expect(_parseByteRange('bytes=1-2,4-5', 10)).toBe('invalid');
  });

  it('stats the file and serves full and partial responses with actual lengths', async () => {
    const { path } = await fixture();
    const full = await _createAssetFileResponse(path, asset, null);
    expect(full.status).toBe(200);
    expect(full.headers.get('content-length')).toBe('10');
    expect([...new Uint8Array(await full.arrayBuffer())]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

    const partial = await _createAssetFileResponse(path, asset, 'bytes=2-5');
    expect(partial.status).toBe(206);
    expect(partial.headers.get('content-range')).toBe('bytes 2-5/10');
    expect([...new Uint8Array(await partial.arrayBuffer())]).toEqual([2, 3, 4, 5]);

    const unsatisfiable = await _createAssetFileResponse(path, asset, 'bytes=10-');
    expect(unsatisfiable.status).toBe(416);
    expect(unsatisfiable.headers.get('content-range')).toBe('bytes */10');
  });

  it('refuses to follow a symlink passed to the serving helper', async () => {
    const { directory, path } = await fixture();
    const link = join(directory, 'linked.mp3');
    await symlink(path, link);
    await expect(_createAssetFileResponse(link, asset, null)).rejects.toMatchObject({
      code: 'ELOOP'
    });
  });
});
