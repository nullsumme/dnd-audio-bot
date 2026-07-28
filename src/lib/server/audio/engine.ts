import { randomUUID } from 'node:crypto';
import type { ActiveSource, AssetRole, AudioAsset } from '$lib/types';
import {
  spawnDecoder,
  type DecoderCallbacks,
  type DecoderHandle,
  type DecoderInput
} from './decoder';
import { PcmMixer } from './mixer';
import { spawnPcmBufferDecoder } from './pcm-buffer-decoder';

interface RuntimeSource {
  public: ActiveSource;
  input: DecoderInput;
  pcm: Buffer | null;
  shouldLoop: boolean;
  decoder: DecoderHandle | null;
  generation: number;
  restartAttempts: number;
  restartTimer: NodeJS.Timeout | null;
}

export const MAX_AMBIENCE_RESTARTS = 3;
export const AMBIENCE_RETRY_DELAY_MILLISECONDS = 1_000;

function clampVolume(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0.7));
}

export class AudioEngine {
  readonly mixer = new PcmMixer();
  #sources = new Map<string, RuntimeSource>();
  #roleBarriers = new Map<AssetRole, Promise<void>>();
  #destroyed = false;

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

  playAsset(
    asset: AudioAsset,
    path: string,
    role: AssetRole,
    volume = 0.7,
    pcm: Buffer | null = null
  ): ActiveSource {
    const shouldLoop = role === 'ambience';
    return this.#start({
      label: asset.name,
      input: { path, loop: shouldLoop },
      pcm: role === 'soundboard' ? pcm : null,
      role,
      volume,
      shouldLoop,
      assetId: asset.id
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
    const stopping = this.#detach(source);
    this.#extendRoleBarrier(source.public.role, [stopping]);
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
    this.#destroyed = true;
    this.stopScope('all');
    this.mixer.destroy();
  }

  #start(input: {
    label: string;
    input: DecoderInput;
    pcm: Buffer | null;
    role: AssetRole;
    volume: number;
    shouldLoop: boolean;
    assetId?: string;
  }): ActiveSource {
    // Soundkeep deliberately exposes exactly two mix lines. Starting a source replaces
    // the current source on that line without disturbing playback on the other line.
    // Decoder termination is asynchronous, so the new decoder waits behind the role's
    // stop barrier. Rapid replacements coalesce because superseded pending sources
    // fail the identity check before they ever spawn FFmpeg.
    const previous = [...this.#sources.values()].filter(
      (source) => source.public.role === input.role
    );
    const stopping = previous.map((source) => this.#detach(source));
    const pendingBarrier = this.#roleBarriers.get(input.role);
    const id = randomUUID();
    const source: RuntimeSource = {
      public: {
        id,
        label: input.label,
        role: input.role,
        volume: clampVolume(input.volume),
        state: 'starting',
        startedAt: new Date().toISOString(),
        ...(input.assetId ? { assetId: input.assetId } : {})
      },
      input: input.input,
      pcm: input.pcm,
      shouldLoop: input.shouldLoop,
      decoder: null,
      generation: 0,
      restartAttempts: 0,
      restartTimer: null
    };
    this.#sources.set(id, source);
    this.#addMixerInput(source);

    if (input.pcm) {
      if (pendingBarrier || stopping.length > 0) this.#extendRoleBarrier(input.role, stopping);
      this.#spawn(source);
    } else if (!pendingBarrier && stopping.length === 0) {
      this.#spawn(source);
    } else {
      const ready = this.#extendRoleBarrier(input.role, stopping);
      void ready.then(() => {
        if (!this.#destroyed && this.#sources.get(id) === source) this.#spawn(source);
      });
    }
    return { ...source.public };
  }

  #spawn(source: RuntimeSource): void {
    if (this.#destroyed || this.#sources.get(source.public.id) !== source) return;
    const generation = ++source.generation;
    source.public.state = source.public.state === 'restarting' ? 'restarting' : 'starting';
    delete source.public.error;

    const callbacks: DecoderCallbacks = {
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
          this.#finishOneShot(source, error);
          return;
        }
        this.#handleAmbienceEnd(source, error);
      }
    };
    source.decoder = source.pcm
      ? spawnPcmBufferDecoder(source.pcm, callbacks)
      : spawnDecoder(source.input, callbacks);
  }

  #finishOneShot(source: RuntimeSource, error: string | null): void {
    if (error) {
      source.public.state = 'failed';
      source.public.error = error;
    }
    const finish = () => {
      if (this.#sources.get(source.public.id) !== source) return;
      if (!error) {
        this.stop(source.public.id);
        return;
      }
      const cleanup = setTimeout(() => this.stop(source.public.id), 5_000);
      cleanup.unref();
      source.restartTimer = cleanup;
    };
    if (!this.mixer.endInput(source.public.id, finish)) finish();
  }

  #handleAmbienceEnd(source: RuntimeSource, error: string | null): void {
    this.mixer.removeInput(source.public.id);
    const message = error ?? 'The ambience decoder ended unexpectedly.';
    if (source.restartAttempts >= MAX_AMBIENCE_RESTARTS) {
      source.public.state = 'failed';
      source.public.error = message;
      return;
    }

    source.restartAttempts += 1;
    source.public.state = 'restarting';
    source.public.error = message;
    source.restartTimer = setTimeout(() => {
      source.restartTimer = null;
      if (this.#sources.get(source.public.id) !== source) return;
      this.#addMixerInput(source);
      this.#spawn(source);
    }, AMBIENCE_RETRY_DELAY_MILLISECONDS);
    source.restartTimer.unref();
  }

  #addMixerInput(source: RuntimeSource): void {
    this.mixer.addInput(source.public.id, source.public.volume, () => source.decoder?.resume());
  }

  #detach(source: RuntimeSource): Promise<void> {
    this.#sources.delete(source.public.id);
    source.generation += 1;
    if (source.restartTimer) clearTimeout(source.restartTimer);
    source.restartTimer = null;
    const decoder = source.decoder;
    source.decoder = null;
    this.mixer.removeInput(source.public.id);
    return decoder?.stop().catch(() => undefined) ?? Promise.resolve();
  }

  #extendRoleBarrier(role: AssetRole, stopping: Promise<void>[]): Promise<void> {
    const previous = this.#roleBarriers.get(role) ?? Promise.resolve();
    const barrier = Promise.all([previous, ...stopping]).then(() => undefined);
    this.#roleBarriers.set(role, barrier);
    void barrier.then(() => {
      if (this.#roleBarriers.get(role) === barrier) this.#roleBarriers.delete(role);
    });
    return barrier;
  }
}
