import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { byteStream, validTestMp3 } from '../../../tests/fixtures/audio';
import {
  AudioLibrary,
  LibraryQuotaError,
  UploadBusyError,
  UploadLimitError,
  type AudioLibraryOptions
} from './library';

const directories: string[] = [];
const validatorPath = resolve('tests/fixtures/media-validator.mjs');
const mp3 = validTestMp3();

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true }))
  );
});

async function createLibrary(options: AudioLibraryOptions = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'soundkeep-library-'));
  directories.push(directory);
  const library = new AudioLibrary(directory, {
    maxUploadBytes: 1024 * 1024,
    maxLibraryBytes: 16 * 1024 * 1024,
    minFreeBytes: 0,
    maxConcurrentUploads: 1,
    ffmpegPath: validatorPath,
    ffprobePath: validatorPath,
    ...options
  });
  await library.initialize();
  return { directory, library };
}

function addInput(
  overrides: Partial<Parameters<AudioLibrary['add']>[0]> = {}
): Parameters<AudioLibrary['add']>[0] {
  return {
    stream: byteStream(mp3, 997),
    contentLength: mp3.byteLength,
    originalFilename: 'storm.mp3',
    name: 'Storm',
    category: 'Weather',
    role: 'ambience',
    ...overrides
  };
}

describe('AudioLibrary', () => {
  it('streams, validates, atomically persists, updates and deletes an MP3', async () => {
    const { directory, library } = await createLibrary();
    const asset = await library.add(addInput());

    expect(asset).toMatchObject({
      name: 'Storm',
      size: mp3.byteLength,
      duration: 2.0875
    });
    expect(await readFile(library.filePath(asset))).toEqual(Buffer.from(mp3));

    const updated = await library.update(asset.id, {
      name: 'Distant storm',
      role: 'soundboard'
    });
    expect(updated).toMatchObject({ name: 'Distant storm', role: 'soundboard' });

    const reloaded = new AudioLibrary(directory, {
      minFreeBytes: 0,
      ffmpegPath: validatorPath,
      ffprobePath: validatorPath
    });
    await reloaded.initialize();
    expect(reloaded.get(asset.id)?.name).toBe('Distant storm');

    const deletion = reloaded.delete(asset.id);
    expect(reloaded.get(asset.id)).toBeNull();
    await deletion;
    expect(reloaded.list()).toEqual([]);
    await expect(readFile(reloaded.filePath(asset))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a fake ID3 payload when ffprobe or full decode cannot validate it', async () => {
    const { library } = await createLibrary();
    const fake = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00]);

    await expect(
      library.add(
        addInput({
          stream: byteStream(fake),
          contentLength: fake.byteLength
        })
      )
    ).rejects.toThrow('Only valid MP3 files');
    expect(library.list()).toEqual([]);
    expect(await readdir(library.audioDir)).toEqual([]);
  });

  it('requires both a successful full decode and a finite positive probed duration', async () => {
    const decodeFailure = await createLibrary({ ffmpegPath: '/bin/false' });
    await expect(decodeFailure.library.add(addInput())).rejects.toThrow('Only valid MP3 files');

    const previousDuration = process.env.SOUNDKEEP_TEST_MEDIA_DURATION;
    process.env.SOUNDKEEP_TEST_MEDIA_DURATION = '0';
    try {
      const invalidDuration = await createLibrary();
      await expect(invalidDuration.library.add(addInput())).rejects.toThrow('Only valid MP3 files');
    } finally {
      if (previousDuration === undefined) delete process.env.SOUNDKEEP_TEST_MEDIA_DURATION;
      else process.env.SOUNDKEEP_TEST_MEDIA_DURATION = previousDuration;
    }
  });

  it('stops and removes an incrementally streamed upload once it exceeds the limit', async () => {
    const { library } = await createLibrary({ maxUploadBytes: 1024 });
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(800));
        controller.enqueue(new Uint8Array(800));
      },
      cancel() {
        cancelled = true;
      }
    });

    await expect(
      library.add(addInput({ stream, contentLength: undefined }))
    ).rejects.toBeInstanceOf(UploadLimitError);
    expect(cancelled).toBe(true);
    expect(await readdir(library.audioDir)).toEqual([]);
  });

  it('rejects excess concurrent uploads before consuming the second body', async () => {
    const { library } = await createLibrary({ maxConcurrentUploads: 1 });
    let finishFirst = () => {};
    const firstStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(mp3);
        finishFirst = () => controller.close();
      }
    });
    const first = library.add(addInput({ stream: firstStream }));

    while (!(await readdir(library.audioDir)).some((name) => name.startsWith('.upload-'))) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 1));
    }
    let secondConsumed = false;
    const secondStream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          secondConsumed = true;
          controller.enqueue(mp3);
          controller.close();
        }
      },
      { highWaterMark: 0 }
    );
    await expect(library.add(addInput({ stream: secondStream }))).rejects.toBeInstanceOf(
      UploadBusyError
    );
    expect(secondConsumed).toBe(false);

    finishFirst();
    await expect(first).resolves.toMatchObject({ size: mp3.byteLength });
  });

  it('enforces a total library quota independently of the per-upload limit', async () => {
    const { library } = await createLibrary({
      maxUploadBytes: mp3.byteLength * 2,
      maxLibraryBytes: mp3.byteLength + 100
    });
    await library.add(addInput());

    await expect(library.add(addInput())).rejects.toBeInstanceOf(LibraryQuotaError);
    expect(library.list()).toHaveLength(1);
  });

  it('serializes metadata mutations and rolls back memory when persistence fails', async () => {
    const { library } = await createLibrary();
    const asset = await library.add(addInput());

    await rm(library.indexPath);
    await mkdir(library.indexPath);
    await expect(library.update(asset.id, { name: 'Should not stick' })).rejects.toThrow();
    expect(library.get(asset.id)?.name).toBe('Storm');
  });

  it('recovers deleting files and removes missing, unsafe, orphan and temporary entries', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'soundkeep-recovery-'));
    directories.push(directory);
    const audioDir = join(directory, 'audio');
    await mkdir(audioDir, { recursive: true });
    const timestamp = '2026-07-27T00:00:00.000Z';
    await writeFile(join(directory, 'outside.mp3'), mp3);
    await writeFile(join(audioDir, 'restored.mp3.deleting'), mp3);
    await writeFile(join(audioDir, 'orphan.mp3'), mp3);
    await writeFile(join(audioDir, '.upload-abandoned.tmp'), mp3);
    await writeFile(
      join(directory, 'library.json'),
      JSON.stringify({
        version: 3,
        assets: [
          {
            id: 'restored',
            name: 'Restored',
            category: 'Recovery',
            role: 'soundboard',
            filename: 'restored.mp3',
            originalFilename: 'restored.mp3',
            size: 1,
            duration: 2,
            createdAt: timestamp,
            updatedAt: timestamp
          },
          {
            id: 'missing',
            name: 'Missing',
            filename: 'missing.mp3',
            role: 'ambience'
          },
          {
            id: 'traversal',
            name: 'Traversal',
            filename: '../outside.mp3',
            role: 'soundboard'
          },
          {
            id: 'duplicate-file',
            name: 'Duplicate',
            filename: 'restored.mp3',
            role: 'soundboard'
          }
        ]
      })
    );

    const library = new AudioLibrary(directory, {
      minFreeBytes: 0,
      ffmpegPath: validatorPath,
      ffprobePath: validatorPath
    });
    await library.initialize();

    expect(library.list()).toEqual([
      expect.objectContaining({ id: 'restored', size: mp3.byteLength })
    ]);
    expect(await readdir(audioDir)).toEqual(['restored.mp3']);
    await expect(readFile(join(directory, 'outside.mp3'))).resolves.toEqual(Buffer.from(mp3));
    expect(() =>
      library.filePath({ ...library.get('restored')!, filename: '../../../proc/self/environ' })
    ).toThrow('unsafe filename');
    const persisted = JSON.parse(await readFile(library.indexPath, 'utf8')) as LibraryIndexForTest;
    expect(persisted.assets).toHaveLength(1);
  });

  it('preserves v1 files and drops only v2 fileless remote entries during migration', async () => {
    for (const version of [1, 2]) {
      const directory = await mkdtemp(join(tmpdir(), `soundkeep-v${version}-`));
      directories.push(directory);
      await mkdir(join(directory, 'audio'), { recursive: true });
      await writeFile(join(directory, 'audio', 'saved.mp3'), mp3);
      await writeFile(
        join(directory, 'library.json'),
        JSON.stringify({
          version,
          assets: [
            {
              id: 'saved',
              name: 'Saved tavern',
              category: 'Taverns',
              role: 'soundboard',
              filename: 'saved.mp3',
              originalFilename: 'tavern.mp3',
              size: mp3.byteLength,
              duration: 60
            },
            ...(version === 2
              ? [
                  {
                    id: 'remote',
                    name: 'Remote rain',
                    role: 'ambience',
                    filename: null
                  }
                ]
              : [])
          ]
        })
      );

      const library = new AudioLibrary(directory, {
        minFreeBytes: 0,
        ffmpegPath: validatorPath,
        ffprobePath: validatorPath
      });
      await library.initialize();
      expect(library.list()).toEqual([
        expect.objectContaining({ id: 'saved', filename: 'saved.mp3' })
      ]);
      const persisted = JSON.parse(
        await readFile(library.indexPath, 'utf8')
      ) as LibraryIndexForTest;
      expect(persisted.version).toBe(3);
    }
  });
});

interface LibraryIndexForTest {
  version: number;
  assets: Array<Record<string, unknown>>;
}
