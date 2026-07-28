import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./youtube', () => ({
  downloadYouTubeMp3: async (_url: string, outputTemplate: string) => {
    await writeFile(
      outputTemplate.replace('%(ext)s', 'mp3'),
      new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00])
    );
  }
}));
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

  it('persists live and downloaded YouTube entries as distinct library types', async () => {
    const { directory, library } = await createLibrary();
    const metadata = {
      title: 'Rainy tavern',
      duration: 321,
      url: 'https://www.youtube.com/watch?v=rain'
    };

    const live = await library.addYouTube({
      metadata,
      mode: 'live',
      name: '',
      category: 'Taverns',
      role: 'ambience'
    });
    expect(live).toMatchObject({
      sourceType: 'youtube-live',
      filename: null,
      youtubeUrl: metadata.url,
      size: 0
    });
    expect(() => library.filePath(live)).toThrow('do not have a local file');

    const saved = await library.addYouTube({
      metadata,
      mode: 'saved',
      name: 'Offline tavern',
      category: 'Taverns',
      role: 'soundboard'
    });
    expect(saved).toMatchObject({
      sourceType: 'youtube-saved',
      name: 'Offline tavern',
      youtubeUrl: metadata.url,
      mimeType: 'audio/mpeg',
      duration: 321
    });
    expect(new Uint8Array(await readFile(library.filePath(saved)))).toEqual(
      new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00])
    );

    const reloaded = new AudioLibrary(directory);
    await reloaded.initialize();
    expect(
      reloaded
        .list()
        .map((asset) => asset.sourceType)
        .sort()
    ).toEqual(['youtube-live', 'youtube-saved']);
  });

  it('migrates the original uploaded-MP3 index without losing its asset', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'soundkeep-library-v1-'));
    directories.push(directory);
    await mkdir(join(directory, 'audio'), { recursive: true });
    const timestamp = '2026-07-27T00:00:00.000Z';
    await writeFile(
      join(directory, 'library.json'),
      JSON.stringify({
        version: 1,
        assets: [
          {
            id: 'legacy',
            name: 'Legacy storm',
            category: 'Weather',
            role: 'ambience',
            filename: 'legacy.mp3',
            originalFilename: 'storm.mp3',
            mimeType: 'audio/mpeg',
            size: 8,
            duration: 12,
            createdAt: timestamp,
            updatedAt: timestamp
          }
        ]
      })
    );
    await writeFile(
      join(directory, 'audio', 'legacy.mp3'),
      new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00])
    );

    const library = new AudioLibrary(directory);
    await library.initialize();
    expect(library.get('legacy')).toMatchObject({
      sourceType: 'mp3',
      youtubeUrl: null,
      filename: 'legacy.mp3'
    });
    const persisted = JSON.parse(await readFile(join(directory, 'library.json'), 'utf8')) as {
      version: number;
    };
    expect(persisted.version).toBe(2);
  });
});
