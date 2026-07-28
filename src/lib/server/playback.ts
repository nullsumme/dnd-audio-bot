import type {
  ActiveSource,
  AssetRole,
  AudioAsset,
  PlaybackState,
  RepeatMode,
  SceneCollection
} from '$lib/types';
import type { AudioPlaybackOptions, SourceEndedEvent, SourceEndedListener } from './audio/engine';

export interface PlaybackLibrary {
  list(): AudioAsset[];
  get(id: string): AudioAsset | null;
  filePath(asset: AudioAsset): string;
}

export interface PlaybackScenes {
  list(): SceneCollection[];
  get(id: string): SceneCollection | null;
}

export interface PlaybackEngine {
  list(): ActiveSource[];
  playAsset(
    asset: AudioAsset,
    path: string,
    role: AssetRole,
    volume?: number,
    pcm?: Buffer | null,
    options?: AudioPlaybackOptions
  ): ActiveSource;
  setRepeat(id: string, repeat: boolean): Promise<ActiveSource>;
  stopScope(scope: 'ambience' | 'soundboard' | 'all'): number;
  onSourceEnded(listener: SourceEndedListener): () => void;
}

export interface PlaybackUpdate {
  activeSceneId?: string | null;
  shuffle?: boolean;
  repeatMode?: RepeatMode;
}

export interface BackgroundPlaybackOptions {
  random?: () => number;
}

function validVolume(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError('Playback volume must be between 0 and 1.');
  }
  return value;
}

function cloneSource(source: ActiveSource): ActiveSource {
  return { ...source };
}

/**
 * Owns the shared background queue independently from the Discord connection.
 *
 * All state transitions are serialized. Decoder completion callbacks therefore
 * cannot overtake a user's play/skip request, and completion from a replaced
 * source is ignored by source id.
 */
export class BackgroundPlaybackCoordinator {
  readonly #library: PlaybackLibrary;
  readonly #scenes: PlaybackScenes;
  readonly #engine: PlaybackEngine;
  readonly #random: () => number;
  readonly #unsubscribe: () => void;

  #activeSceneId: string | null = null;
  #queue: string[] = [];
  #currentAssetId: string | null = null;
  #currentSourceId: string | null = null;
  #currentVolume = 0.7;
  #shuffle = false;
  #repeatMode: RepeatMode = 'off';
  #barrier: Promise<void> = Promise.resolve();
  #destroyed = false;

  constructor(
    library: PlaybackLibrary,
    scenes: PlaybackScenes,
    engine: PlaybackEngine,
    options: BackgroundPlaybackOptions = {}
  ) {
    this.#library = library;
    this.#scenes = scenes;
    this.#engine = engine;
    this.#random = options.random ?? Math.random;
    this.#queue = this.#canonicalQueue();
    this.#unsubscribe = engine.onSourceEnded((event) => {
      void this.#serialize(() => this.#handleSourceEnded(event)).catch((error) => {
        console.error(
          `Background playback completion: ${
            error instanceof Error ? error.message : 'unknown playback error'
          }`
        );
      });
    });
  }

  snapshot(): PlaybackState {
    return {
      activeSceneId: this.#activeSceneId,
      queue: [...this.#queue],
      currentAssetId: this.#currentAssetId,
      shuffle: this.#shuffle,
      repeatMode: this.#repeatMode
    };
  }

  update(input: PlaybackUpdate): Promise<PlaybackState> {
    return this.#serialize(async () => {
      await this.#reconcile();

      let rebuildQueue = false;
      let reshuffle = false;
      if (input.activeSceneId !== undefined) {
        if (input.activeSceneId !== null && !this.#scenes.get(input.activeSceneId)) {
          throw new Error('Scene not found.');
        }
        if (input.activeSceneId !== this.#activeSceneId) {
          this.#activeSceneId = input.activeSceneId;
          rebuildQueue = true;
          reshuffle = this.#shuffle;
        }
      }

      if (input.shuffle !== undefined && input.shuffle !== this.#shuffle) {
        this.#shuffle = input.shuffle;
        rebuildQueue = true;
        reshuffle = input.shuffle;
      }

      if (rebuildQueue) this.#rebuildQueue(reshuffle);

      if (input.repeatMode !== undefined && input.repeatMode !== this.#repeatMode) {
        if (!['off', 'all', 'one'].includes(input.repeatMode)) {
          throw new Error('Unsupported repeat mode.');
        }
        this.#repeatMode = input.repeatMode;
        await this.#synchronizeEngineRepeat();
      }

      return this.snapshot();
    });
  }

  selectScene(activeSceneId: string | null): Promise<PlaybackState> {
    return this.update({ activeSceneId });
  }

  setShuffle(shuffle: boolean): Promise<PlaybackState> {
    return this.update({ shuffle });
  }

  setRepeatMode(repeatMode: RepeatMode): Promise<PlaybackState> {
    return this.update({ repeatMode });
  }

  play(asset: AudioAsset | string, volume = 0.7): Promise<ActiveSource> {
    return this.#serialize(async () => {
      await this.#reconcile();
      const id = typeof asset === 'string' ? asset : asset.id;
      const current = this.#library.get(id);
      if (!current) throw new Error('Audio asset not found.');
      return this.#playAsset(current, validVolume(volume));
    });
  }

  next(): Promise<ActiveSource | null> {
    return this.#serialize(async () => {
      await this.#reconcile();
      return this.#move(1);
    });
  }

  previous(): Promise<ActiveSource | null> {
    return this.#serialize(async () => {
      await this.#reconcile();
      return this.#move(-1);
    });
  }

  reconcile(): Promise<PlaybackState> {
    return this.#serialize(async () => {
      await this.#reconcile();
      return this.snapshot();
    });
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#unsubscribe();
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#destroyed) {
      return Promise.reject(new Error('Background playback has been destroyed.'));
    }
    const result = this.#barrier.then(operation, operation);
    this.#barrier = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  async #reconcile(): Promise<void> {
    if (this.#activeSceneId !== null && !this.#scenes.get(this.#activeSceneId)) {
      this.#activeSceneId = null;
    }
    this.#rebuildQueue(false);

    const ambienceSources = this.#engine.list().filter((source) => source.role === 'ambience');
    const source =
      ambienceSources.find((candidate) => candidate.id === this.#currentSourceId) ??
      ambienceSources.at(-1) ??
      null;
    if (!source) {
      this.#currentSourceId = null;
      this.#currentAssetId = null;
      return;
    }

    const asset = source.assetId ? this.#library.get(source.assetId) : null;
    if (!asset || asset.role !== 'ambience') {
      this.#engine.stopScope('ambience');
      this.#currentSourceId = null;
      this.#currentAssetId = null;
      return;
    }

    this.#currentSourceId = source.id;
    this.#currentAssetId = asset.id;
    this.#currentVolume = source.volume;
    if (source.repeat !== (this.#repeatMode === 'one')) {
      await this.#engine.setRepeat(source.id, this.#repeatMode === 'one');
    }
  }

  #canonicalQueue(): string[] {
    const assets = this.#library.list();
    const ambience = new Map(
      assets.filter((asset) => asset.role === 'ambience').map((asset) => [asset.id, asset])
    );
    const requestedIds =
      this.#activeSceneId === null
        ? assets.filter((asset) => asset.role === 'ambience').map((asset) => asset.id)
        : (this.#scenes.get(this.#activeSceneId)?.trackIds ?? []);
    const result: string[] = [];
    const seen = new Set<string>();
    for (const id of requestedIds) {
      if (seen.has(id) || !ambience.has(id)) continue;
      seen.add(id);
      result.push(id);
    }
    return result;
  }

  #rebuildQueue(reshuffle: boolean): void {
    const canonical = this.#canonicalQueue();
    if (!this.#shuffle) {
      this.#queue = canonical;
      return;
    }

    if (reshuffle) {
      this.#queue = this.#shuffled(canonical);
      return;
    }

    const valid = new Set(canonical);
    const retained = this.#queue.filter((id) => valid.delete(id));
    this.#queue = [...retained, ...this.#shuffled(canonical.filter((id) => valid.has(id)))];
  }

  #shuffled(ids: readonly string[]): string[] {
    const shuffled = [...ids];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const sample = this.#random();
      const normalized = Number.isFinite(sample) ? Math.max(0, Math.min(0.999999999, sample)) : 0;
      const target = Math.floor(normalized * (index + 1));
      [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
    }
    return shuffled;
  }

  #playAsset(asset: AudioAsset, volume: number): ActiveSource {
    if (asset.role !== 'ambience') {
      throw new Error('Only background tracks can be added to background playback.');
    }
    const source = this.#engine.playAsset(
      asset,
      this.#library.filePath(asset),
      'ambience',
      volume,
      null,
      { repeat: this.#repeatMode === 'one' }
    );
    this.#currentAssetId = asset.id;
    this.#currentSourceId = source.id;
    this.#currentVolume = source.volume;
    return cloneSource(source);
  }

  #move(direction: 1 | -1): ActiveSource | null {
    if (this.#queue.length === 0) {
      this.#stopCurrent();
      return null;
    }

    const index = this.#currentAssetId === null ? -1 : this.#queue.indexOf(this.#currentAssetId);
    let target: number;
    if (index === -1) {
      target = direction === 1 ? 0 : this.#queue.length - 1;
    } else {
      target = index + direction;
      if (target < 0 || target >= this.#queue.length) {
        if (this.#repeatMode !== 'all') {
          this.#stopCurrent();
          return null;
        }
        target = target < 0 ? this.#queue.length - 1 : 0;
      }
    }

    const asset = this.#library.get(this.#queue[target]);
    if (!asset || asset.role !== 'ambience') {
      this.#rebuildQueue(false);
      return this.#move(direction);
    }
    return this.#playAsset(asset, this.#currentVolume);
  }

  #stopCurrent(): void {
    this.#engine.stopScope('ambience');
    this.#currentSourceId = null;
    this.#currentAssetId = null;
  }

  async #synchronizeEngineRepeat(): Promise<void> {
    if (!this.#currentSourceId) return;
    const source = this.#engine
      .list()
      .find((candidate) => candidate.role === 'ambience' && candidate.id === this.#currentSourceId);
    if (!source) {
      this.#currentSourceId = null;
      this.#currentAssetId = null;
      return;
    }
    if (source.repeat !== (this.#repeatMode === 'one')) {
      await this.#engine.setRepeat(source.id, this.#repeatMode === 'one');
    }
  }

  async #handleSourceEnded(event: SourceEndedEvent): Promise<void> {
    if (
      event.reason !== 'completed' ||
      event.source.role !== 'ambience' ||
      event.source.id !== this.#currentSourceId
    ) {
      return;
    }

    const endedAssetId = event.source.assetId ?? this.#currentAssetId;
    this.#currentSourceId = null;
    this.#currentAssetId = endedAssetId;
    this.#currentVolume = event.source.volume;
    this.#rebuildQueue(false);

    if (this.#repeatMode === 'one' && endedAssetId) {
      const asset = this.#library.get(endedAssetId);
      if (asset?.role === 'ambience') {
        this.#playAsset(asset, this.#currentVolume);
        return;
      }
    }
    this.#move(1);
  }
}
