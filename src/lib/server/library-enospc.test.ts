import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { byteStream, validTestMp3 } from '../../../tests/fixtures/audio';

const indexFailure = vi.hoisted(() => ({ armed: false }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    async open(...args: Parameters<typeof actual.open>) {
      if (indexFailure.armed && String(args[0]).includes('.library-index-')) {
        indexFailure.armed = false;
        throw Object.assign(new Error('No space left on device'), { code: 'ENOSPC' });
      }
      return actual.open(...args);
    }
  };
});

import { AudioLibrary } from './library';

const directories: string[] = [];
const validatorPath = resolve('tests/fixtures/media-validator.mjs');

afterEach(async () => {
  indexFailure.armed = false;
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true }))
  );
});

describe('AudioLibrary disk-full recovery', () => {
  it('removes the asset to free space and retries the index commit after ENOSPC', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'soundkeep-enospc-'));
    directories.push(directory);
    const library = new AudioLibrary(directory, {
      maxUploadBytes: 1024 * 1024,
      maxLibraryBytes: 16 * 1024 * 1024,
      minFreeBytes: 0,
      maxConcurrentUploads: 1,
      ffmpegPath: validatorPath,
      ffprobePath: validatorPath
    });
    await library.initialize();
    const bytes = validTestMp3();
    const asset = await library.add({
      stream: byteStream(bytes),
      contentLength: bytes.byteLength,
      originalFilename: 'delete-me.mp3',
      name: 'Delete me',
      category: 'Test',
      role: 'soundboard'
    });

    indexFailure.armed = true;
    await expect(library.delete(asset.id)).resolves.toMatchObject({ id: asset.id });
    expect(library.list()).toEqual([]);
    await expect(readFile(library.filePath(asset))).rejects.toMatchObject({ code: 'ENOENT' });
    const persisted = JSON.parse(await readFile(library.indexPath, 'utf8')) as {
      assets: unknown[];
    };
    expect(persisted.assets).toEqual([]);
  });
});
