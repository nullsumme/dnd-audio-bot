import { randomUUID } from 'node:crypto';
import type { ActiveSource, AssetRole, AudioAsset } from '$lib/types';
import { spawnDecoder, type DecoderHandle, type DecoderInput } from './decoder';
import { PcmMixer } from './mixer';

interface RuntimeSource {
  public: ActiveSource;
  input: DecoderInput;
  shouldLoop: boolean;
  decoder: DecoderHandle | null;
  generation: number;
  restartTimer: NodeJS.Timeout | null;
}

function clampVolume(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0.7));
}

export class AudioEngine {
  readonly mixer = new PcmMixer();
  #sources = new Map<string, RuntimeSource>();

  list(): ActiveSource[] {
    return [...this.#sources.values()]
      .map((source) => ({ ...source.public }))
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }

  get masterVolume(): number {
    return this.mixer.masterVolume;
  }

  setMasterVolume(volume: number): number {
    this.mixer.setMasterVolume(clampVolume(volume));
    return this.mixer.masterVolume;
  }

  playAsset(asset: AudioAsset, path: string | null, role: AssetRole, volume = 0.7): ActiveSource {
    const shouldLoop = role === 'ambience';
    if (asset.sourceType === 'youtube-live' && !asset.youtubeUrl) {
      throw new Error('This live YouTube asset is missing its URL.');
    }
    if (asset.sourceType !== 'youtube-live' && !path) {
      throw new Error('This saved audio asset is missing its local file.');
    }
    return this.#start({
      label: asset.name,
      input:
        asset.sourceType === 'youtube-live'
          ? { kind: 'youtube', url: asset.youtubeUrl!, loop: shouldLoop }
          : { kind: 'file', path: path!, loop: shouldLoop },
      origin: asset.sourceType === 'youtube-live' ? 'youtube' : 'library',
      role,
      volume,
      shouldLoop,
      assetId: asset.id,
      url: asset.youtubeUrl ?? undefined
    });
  }

  setSourceVolume(id: string, volume: number): ActiveSource {
    const source = this.#sources.get(id);
    if (!source) throw new Error('Active source not found.');
    source.public.volume = clampVolume(volume);
    this.mixer.setInputVolume(id, source.public.volume);
    return { ...source.public };
  }

  stop(id: string): boolean {
    const source = this.#sources.get(id);
    if (!source) return false;
    this.#sources.delete(id);
    source.generation += 1;
    if (source.restartTimer) clearTimeout(source.restartTimer);
    source.decoder?.stop();
    this.mixer.removeInput(id);
    return true;
  }

  stopByAsset(assetId: string): number {
    const ids = [...this.#sources.values()]
      .filter((source) => source.public.assetId === assetId)
      .map((source) => source.public.id);
    ids.forEach((id) => this.stop(id));
    return ids.length;
  }

  stopScope(scope: 'ambience' | 'soundboard' | 'all'): number {
    const ids = [...this.#sources.values()]
      .filter((source) => scope === 'all' || source.public.role === scope)
      .map((source) => source.public.id);
    ids.forEach((id) => this.stop(id));
    return ids.length;
  }

  destroy(): void {
    this.stopScope('all');
    this.mixer.destroy();
  }

  #start(input: {
    label: string;
    input: DecoderInput;
    origin: 'youtube' | 'library';
    role: AssetRole;
    volume: number;
    shouldLoop: boolean;
    assetId?: string;
    url?: string;
  }): ActiveSource {
    // Soundkeep deliberately exposes exactly two mix lines. Starting a source replaces
    // the current source on that line without disturbing playback on the other line.
    this.stopScope(input.role);
    const id = randomUUID();
    const source: RuntimeSource = {
      public: {
        id,
        label: input.label,
        origin: input.origin,
        role: input.role,
        volume: clampVolume(input.volume),
        state: 'starting',
        startedAt: new Date().toISOString(),
        ...(input.assetId ? { assetId: input.assetId } : {}),
        ...(input.url ? { url: input.url } : {})
      },
      input: input.input,
      shouldLoop: input.shouldLoop,
      decoder: null,
      generation: 0,
      restartTimer: null
    };
    this.#sources.set(id, source);
    this.mixer.addInput(id, source.public.volume, () => source.decoder?.resume());
    this.#spawn(source);
    return { ...source.public };
  }

  #spawn(source: RuntimeSource): void {
    const generation = ++source.generation;
    source.public.state = source.public.state === 'restarting' ? 'restarting' : 'starting';
    delete source.public.error;

    source.decoder = spawnDecoder(source.input, {
      onData: (chunk) => {
        return source.generation === generation && this.mixer.append(source.public.id, chunk);
      },
      onPlaying: () => {
        if (source.generation === generation) source.public.state = 'playing';
      },
      onEnd: (error) => {
        if (source.generation !== generation || !this.#sources.has(source.public.id)) return;
        source.decoder = null;
        if (!source.shouldLoop) {
          if (error) {
            source.public.state = 'failed';
            source.public.error = error;
            const cleanup = setTimeout(() => this.stop(source.public.id), 5_000);
            cleanup.unref();
          } else {
            this.stop(source.public.id);
          }
          return;
        }

        source.public.state = 'restarting';
        if (error) source.public.error = error;
        source.restartTimer = setTimeout(
          () => {
            source.restartTimer = null;
            if (this.#sources.has(source.public.id)) this.#spawn(source);
          },
          error ? 3_000 : 500
        );
        source.restartTimer.unref();
      }
    });
  }
}
