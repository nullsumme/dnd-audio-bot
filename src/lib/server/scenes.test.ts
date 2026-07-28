import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SceneNotFoundError, SceneStore } from './scenes';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true }))
  );
});

async function fixture(prefix = 'soundkeep-scenes-') {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  directories.push(directory);
  const scenes = new SceneStore(directory);
  return { directory, scenes };
}

describe('SceneStore', () => {
  it('normalizes, atomically persists, updates and deletes track-only and effect-only scenes', async () => {
    const { directory, scenes } = await fixture();
    await scenes.initialize();

    const trackOnly = await scenes.create({
      name: '  Haunted \n Crypt  ',
      description: '  Echoes \t below  ',
      trackIds: ['track-2', 'track-1', 'track-2']
    });
    expect(trackOnly).toMatchObject({
      name: 'Haunted Crypt',
      description: 'Echoes below',
      trackIds: ['track-2', 'track-1'],
      effectIds: []
    });

    const effectOnly = await scenes.create({
      name: 'Combat reactions',
      effectIds: ['effect-1']
    });
    expect(effectOnly.trackIds).toEqual([]);

    await expect(scenes.create({ name: 'Empty', trackIds: [], effectIds: [] })).rejects.toThrow(
      'at least one background track or sound effect'
    );

    const updated = await scenes.update(trackOnly.id, {
      name: '  Final crypt ',
      trackIds: [],
      effectIds: ['effect-2', 'effect-2']
    });
    expect(updated).toMatchObject({
      name: 'Final crypt',
      trackIds: [],
      effectIds: ['effect-2']
    });
    await expect(scenes.update(updated.id, { effectIds: [] })).rejects.toThrow(
      'at least one background track or sound effect'
    );

    const reloaded = new SceneStore(directory);
    await reloaded.initialize();
    expect(reloaded.list()).toEqual([updated, effectOnly]);

    const deleted = await reloaded.delete(effectOnly.id);
    expect(deleted.id).toBe(effectOnly.id);
    expect(reloaded.get(effectOnly.id)).toBeNull();
    await expect(reloaded.delete(effectOnly.id)).rejects.toBeInstanceOf(SceneNotFoundError);

    const persisted = JSON.parse(await readFile(reloaded.indexPath, 'utf8')) as SceneIndexForTest;
    expect(persisted.version).toBe(2);
    expect(persisted.scenes).toHaveLength(1);
  });

  it('migrates and cleans a legacy v1 index without changing assignment order', async () => {
    const { directory, scenes } = await fixture('soundkeep-scenes-migration-');
    await writeFile(
      scenes.indexPath,
      JSON.stringify({
        version: 1,
        scenes: [
          {
            id: 'legacy-scene',
            name: '  Tavern \n Night ',
            description: '  Drinks   and rumors ',
            trackIds: ['track-b', 'track-a', 'track-b'],
            effectIds: ['effect-a', 'effect-a'],
            custom: true
          },
          {
            id: 'legacy-scene',
            name: 'Duplicate',
            description: '',
            trackIds: ['track-c'],
            effectIds: []
          },
          {
            id: 'empty-scene',
            name: 'Empty',
            description: '',
            trackIds: [],
            effectIds: []
          }
        ]
      })
    );

    await scenes.initialize();

    expect(scenes.list()).toEqual([
      expect.objectContaining({
        id: 'legacy-scene',
        name: 'Tavern Night',
        description: 'Drinks and rumors',
        trackIds: ['track-b', 'track-a'],
        effectIds: ['effect-a']
      })
    ]);
    expect(Number.isFinite(Date.parse(scenes.list()[0].createdAt))).toBe(true);
    const persisted = JSON.parse(await readFile(scenes.indexPath, 'utf8')) as SceneIndexForTest;
    expect(persisted.version).toBe(2);
    expect(persisted.scenes).toEqual([
      expect.not.objectContaining({
        custom: true
      })
    ]);
  });

  it('recovers valid records while removing invalid records and abandoned temporary files', async () => {
    const { directory, scenes } = await fixture('soundkeep-scenes-recovery-');
    await writeFile(join(directory, '.scenes-abandoned.tmp'), 'partial');
    await mkdir(join(directory, 'scenes.json.abandoned.tmp'));
    await writeFile(
      scenes.indexPath,
      JSON.stringify({
        version: 2,
        scenes: [
          {
            id: 'recoverable',
            name: '  Recovery scene ',
            description: ' Still usable ',
            trackIds: ['track-a', 'track-a'],
            effectIds: [],
            createdAt: 'not-a-date',
            updatedAt: 'also-not-a-date',
            ignored: true
          },
          {
            id: 'invalid-assignments',
            name: 'Broken',
            description: '',
            trackIds: [false],
            effectIds: []
          },
          null
        ]
      })
    );

    await scenes.initialize();

    expect(scenes.list()).toEqual([
      expect.objectContaining({
        id: 'recoverable',
        name: 'Recovery scene',
        trackIds: ['track-a']
      })
    ]);
    expect(await readdir(directory)).toEqual(['scenes.json']);
    const persisted = JSON.parse(await readFile(scenes.indexPath, 'utf8')) as SceneIndexForTest;
    expect(persisted.scenes).toHaveLength(1);
    expect(persisted.scenes[0]).not.toHaveProperty('ignored');
  });

  it('does not publish concurrent mutations when atomic persistence fails', async () => {
    const { scenes } = await fixture();
    await scenes.initialize();
    const first = await scenes.create({ name: 'First', trackIds: ['track-1'] });

    await rm(scenes.indexPath);
    await mkdir(scenes.indexPath);
    await expect(scenes.create({ name: 'Second', effectIds: ['effect-1'] })).rejects.toThrow();
    expect(scenes.list()).toEqual([first]);
  });

  it('serializes concurrent creates and persists every collection', async () => {
    const { directory, scenes } = await fixture();
    await scenes.initialize();

    await Promise.all([
      scenes.create({ name: 'One', trackIds: ['track-1'] }),
      scenes.create({ name: 'Two', effectIds: ['effect-1'] }),
      scenes.create({ name: 'Three', trackIds: ['track-2'], effectIds: ['effect-2'] })
    ]);

    const reloaded = new SceneStore(directory);
    await reloaded.initialize();
    expect(reloaded.list().map((scene) => scene.name)).toEqual(['One', 'Two', 'Three']);
  });

  it('removes deleted asset references and drops scenes that would become empty', async () => {
    const { directory, scenes } = await fixture();
    await scenes.initialize();
    const mixed = await scenes.create({
      name: 'Mixed',
      trackIds: ['track-1'],
      effectIds: ['effect-1']
    });
    const effectOnly = await scenes.create({
      name: 'Effect only',
      effectIds: ['effect-1']
    });
    const untouched = await scenes.create({
      name: 'Untouched',
      trackIds: ['track-2']
    });

    const cleanup = await scenes.removeAssetReferences('effect-1');
    expect(cleanup.updated).toEqual([
      expect.objectContaining({ id: mixed.id, trackIds: ['track-1'], effectIds: [] })
    ]);
    expect(cleanup.deleted).toEqual([effectOnly]);
    expect(scenes.list().map((scene) => scene.id)).toEqual([mixed.id, untouched.id]);

    expect(await scenes.removeAssetReferences('not-referenced')).toEqual({
      updated: [],
      deleted: []
    });
    const finalCleanup = await scenes.removeAssetReferences('track-1');
    expect(finalCleanup.deleted.map((scene) => scene.id)).toEqual([mixed.id]);

    const reloaded = new SceneStore(directory);
    await reloaded.initialize();
    expect(reloaded.list()).toEqual([untouched]);
  });

  it('rejects malformed or unsupported root indexes without overwriting them', async () => {
    const { scenes } = await fixture();
    await writeFile(scenes.indexPath, JSON.stringify({ version: 99, scenes: [] }));
    await expect(scenes.initialize()).rejects.toThrow('Unsupported scene collection index');

    const malformedFixture = await fixture();
    await writeFile(malformedFixture.scenes.indexPath, '{');
    await expect(malformedFixture.scenes.initialize()).rejects.toThrow();
    await expect(readFile(malformedFixture.scenes.indexPath, 'utf8')).resolves.toBe('{');
  });
});

interface SceneIndexForTest {
  version: number;
  scenes: Array<Record<string, unknown>>;
}
