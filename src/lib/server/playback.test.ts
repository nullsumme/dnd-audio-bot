import { describe, expect, it } from 'vitest';
import type { ActiveSource, AudioAsset, SceneCollection } from '$lib/types';
import type { SourceEndedEvent, SourceEndedListener } from './audio/engine';
import {
  BackgroundPlaybackCoordinator,
  type PlaybackEngine,
  type PlaybackLibrary,
  type PlaybackScenes
} from './playback';

const timestamp = '2026-07-28T10:00:00.000Z';

function asset(id: string, role: AudioAsset['role'] = 'ambience'): AudioAsset {
  return {
    id,
    name: id.toUpperCase(),
    category: role === 'ambience' ? 'Ambience' : 'Effects',
    role,
    filename: `${id}.mp3`,
    originalFilename: `${id}.mp3`,
    mimeType: 'audio/mpeg',
    size: 1_024,
    duration: 60,
    subtitle: '',
    mood: '',
    icon: 'music',
    artworkFilename: null,
    artworkMimeType: null,
    artworkSize: 0,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function scene(id: string, trackIds: string[]): SceneCollection {
  return {
    id,
    name: id.toUpperCase(),
    description: '',
    trackIds,
    effectIds: [],
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

class FakeLibrary implements PlaybackLibrary {
  constructor(public assets: AudioAsset[]) {}

  list(): AudioAsset[] {
    return [...this.assets];
  }

  get(id: string): AudioAsset | null {
    return this.assets.find((candidate) => candidate.id === id) ?? null;
  }

  filePath(input: AudioAsset): string {
    return `/audio/${input.filename}`;
  }
}

class FakeScenes implements PlaybackScenes {
  constructor(public scenes: SceneCollection[]) {}

  list(): SceneCollection[] {
    return [...this.scenes];
  }

  get(id: string): SceneCollection | null {
    return this.scenes.find((candidate) => candidate.id === id) ?? null;
  }
}

class FakeEngine implements PlaybackEngine {
  sources: ActiveSource[] = [];
  played: Array<{ assetId: string; volume: number; repeat: boolean }> = [];
  repeatUpdates: Array<{ sourceId: string; repeat: boolean }> = [];
  stopped = 0;
  #nextId = 1;
  #listeners = new Set<SourceEndedListener>();

  list(): ActiveSource[] {
    return this.sources.map((source) => ({ ...source }));
  }

  playAsset(
    input: AudioAsset,
    _path: string,
    _role: 'ambience' | 'soundboard',
    volume = 0.7,
    _pcm: Buffer | null = null,
    options: { repeat?: boolean } = {}
  ): ActiveSource {
    const source: ActiveSource = {
      id: `source-${this.#nextId++}`,
      label: input.name,
      role: 'ambience',
      volume,
      state: 'playing',
      startedAt: timestamp,
      duration: input.duration,
      positionMilliseconds: 0,
      repeat: options.repeat ?? false,
      assetId: input.id
    };
    this.sources = [source];
    this.played.push({ assetId: input.id, volume, repeat: source.repeat });
    return { ...source };
  }

  async setRepeat(id: string, repeat: boolean): Promise<ActiveSource> {
    const source = this.sources.find((candidate) => candidate.id === id);
    if (!source) throw new Error('Active source not found.');
    source.repeat = repeat;
    this.repeatUpdates.push({ sourceId: id, repeat });
    return { ...source };
  }

  stopScope(): number {
    const count = this.sources.length;
    this.sources = [];
    this.stopped += 1;
    return count;
  }

  onSourceEnded(listener: SourceEndedListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  complete(source: ActiveSource): void {
    if (this.sources.some((candidate) => candidate.id === source.id)) {
      this.sources = this.sources.filter((candidate) => candidate.id !== source.id);
    }
    const event: SourceEndedEvent = { source: { ...source }, reason: 'completed' };
    for (const listener of this.#listeners) listener(event);
  }
}

function fixture() {
  const tracks = [
    asset('track-b'),
    asset('effect', 'soundboard'),
    asset('track-a'),
    asset('track-c')
  ];
  const library = new FakeLibrary(tracks);
  const scenes = new FakeScenes([
    scene('scene-one', ['track-a', 'track-b']),
    scene('scene-two', ['track-c'])
  ]);
  const engine = new FakeEngine();
  const playback = new BackgroundPlaybackCoordinator(library, scenes, engine, {
    random: () => 0
  });
  return { library, scenes, engine, playback, tracks };
}

describe('background playback coordinator', () => {
  it('derives the global queue in library order and a selected queue in scene order', async () => {
    const { playback } = fixture();

    expect(playback.snapshot().queue).toEqual(['track-b', 'track-a', 'track-c']);
    expect(await playback.selectScene('scene-one')).toMatchObject({
      activeSceneId: 'scene-one',
      queue: ['track-a', 'track-b']
    });
    await expect(playback.selectScene('missing')).rejects.toThrow('Scene not found');
  });

  it('shuffles the same membership without replacing the current track', async () => {
    const { playback, engine, tracks } = fixture();
    const current = await playback.play(tracks[0], 0.42);

    const shuffled = await playback.setShuffle(true);
    expect(new Set(shuffled.queue)).toEqual(new Set(['track-b', 'track-a', 'track-c']));
    expect(shuffled.queue).not.toEqual(['track-b', 'track-a', 'track-c']);
    expect(shuffled.currentAssetId).toBe('track-b');
    expect(engine.sources[0].id).toBe(current.id);
    expect(engine.played).toHaveLength(1);

    const ordered = await playback.setShuffle(false);
    expect(ordered.queue).toEqual(['track-b', 'track-a', 'track-c']);
    expect(ordered.currentAssetId).toBe('track-b');
  });

  it('moves forward and backward with the current volume and stops at off-mode boundaries', async () => {
    const { playback, engine, tracks } = fixture();
    await playback.play(tracks[0], 0.35);

    expect((await playback.next())?.assetId).toBe('track-a');
    expect(engine.played.at(-1)).toEqual({
      assetId: 'track-a',
      volume: 0.35,
      repeat: false
    });
    expect((await playback.previous())?.assetId).toBe('track-b');
    expect(await playback.previous()).toBeNull();
    expect(playback.snapshot().currentAssetId).toBeNull();
    expect(engine.sources).toHaveLength(0);
  });

  it('auto-advances in off mode, stops at the end, and wraps in all mode', async () => {
    const { playback, engine } = fixture();
    await playback.selectScene('scene-one');
    const first = await playback.play('track-a');

    engine.complete(first);
    await playback.reconcile();
    expect(playback.snapshot().currentAssetId).toBe('track-b');

    const last = engine.sources[0];
    engine.complete(last);
    await playback.reconcile();
    expect(playback.snapshot().currentAssetId).toBeNull();

    await playback.setRepeatMode('all');
    const endAgain = await playback.play('track-b');
    engine.complete(endAgain);
    await playback.reconcile();
    expect(playback.snapshot().currentAssetId).toBe('track-a');
  });

  it('configures one-track repeat and replays a matching unexpected completion', async () => {
    const { playback, engine } = fixture();
    await playback.setRepeatMode('one');
    const current = await playback.play('track-a', 0.6);
    expect(engine.played.at(-1)).toEqual({
      assetId: 'track-a',
      volume: 0.6,
      repeat: true
    });

    engine.complete(current);
    await playback.reconcile();
    expect(playback.snapshot().currentAssetId).toBe('track-a');
    expect(engine.played).toHaveLength(2);
    expect(engine.played.at(-1)?.repeat).toBe(true);

    await playback.setRepeatMode('off');
    expect(engine.repeatUpdates.at(-1)?.repeat).toBe(false);
  });

  it('ignores stale completion after a newer play request', async () => {
    const { playback, engine } = fixture();
    const stale = await playback.play('track-b');
    const current = await playback.play('track-c');

    engine.complete(stale);
    await playback.reconcile();

    expect(playback.snapshot().currentAssetId).toBe('track-c');
    expect(engine.sources[0].id).toBe(current.id);
    expect(engine.played.map((entry) => entry.assetId)).toEqual(['track-b', 'track-c']);
  });

  it('reconciles deleted scenes, assets, and externally stopped sources', async () => {
    const { playback, engine, library, scenes } = fixture();
    await playback.selectScene('scene-one');
    await playback.play('track-a');

    scenes.scenes = [];
    library.assets = library.assets.filter((candidate) => candidate.id !== 'track-a');
    const reconciled = await playback.reconcile();
    expect(reconciled.activeSceneId).toBeNull();
    expect(reconciled.queue).toEqual(['track-b', 'track-c']);
    expect(reconciled.currentAssetId).toBeNull();
    expect(engine.sources).toHaveLength(0);

    await playback.play('track-b');
    engine.sources = [];
    expect((await playback.reconcile()).currentAssetId).toBeNull();
  });
});
