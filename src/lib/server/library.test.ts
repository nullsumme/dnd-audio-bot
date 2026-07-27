import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { AudioLibrary } from './library';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function createLibrary() {
  const directory = await mkdtemp(join(tmpdir(), 'soundkeep-library-'));
  directories.push(directory);
  const library = new AudioLibrary(directory);
  await library.initialize();
  return { directory, library };
}

describe('AudioLibrary', () => {
  it('persists, updates and deletes uploaded MP3 metadata and bytes', async () => {
    const { directory, library } = await createLibrary();
    const bytes = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00]);

    const asset = await library.add({
      bytes,
      originalFilename: 'storm.mp3',
      name: 'Storm',
      category: 'Weather',
      role: 'ambience'
    });
    expect(library.list()).toHaveLength(1);
    expect(new Uint8Array(await readFile(library.filePath(asset)))).toEqual(bytes);

    const updated = await library.update(asset.id, {
      name: 'Distant storm',
      role: 'soundboard'
    });
    expect(updated.name).toBe('Distant storm');
    expect(updated.role).toBe('soundboard');

    const reloaded = new AudioLibrary(directory);
    await reloaded.initialize();
    expect(reloaded.get(asset.id)?.name).toBe('Distant storm');

    await reloaded.delete(asset.id);
    expect(reloaded.list()).toEqual([]);
    await expect(readFile(reloaded.filePath(asset))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects non-MP3 data and unsafe extensions', async () => {
    const { library } = await createLibrary();
    await expect(
      library.add({
        bytes: new Uint8Array([1, 2, 3, 4]),
        originalFilename: '../noise.wav',
        name: 'Noise',
        category: 'Effects',
        role: 'soundboard'
      })
    ).rejects.toThrow('Only valid MP3 files');
  });
});
