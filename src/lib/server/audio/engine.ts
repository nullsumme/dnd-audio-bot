import { randomUUID } from 'node:crypto';
import type { ActiveSource, AssetRole, AudioAsset, SourceState } from '$lib/types';
import {
  spawnDecoder,
  type DecoderCallbacks,
  type DecoderHandle,
  type DecoderInput
} from './decoder';
import { PCM_BYTES_PER_MILLISECOND, PcmMixer } from './mixer';
import { spawnPcmBufferDecoder } from './pcm-buffer-decoder';

export interface AudioPlaybackOptions {
  /** Duration in seconds, matching AudioAsset.duration. Defaults to the asset duration. */
  duration?: number | null;
  /** Defaults to true for ambience and false for soundboard playback. */
  repeat?: boolean;
  /** Initial playback offset in milliseconds. */
  offsetMilliseconds?: number;
}

export interface AudioTransportUpdate {
  positionMilliseconds?: number;
  repeat?: boolean;
}

export interface SourceEndedEvent {
  source: ActiveSource;
  reason: 'completed';
}

export type SourceEndedListener = (event: SourceEndedEvent) => void;

interface RuntimeSource {
  public: ActiveSource;
  path: string;
  pcm: Buffer | null;
  decoder: DecoderHandle | null;
  generation: number;
  restartAttempts: number;
  restartTimer: NodeJS.Timeout | null;
  startBarrier: Promise<void> | null;
  restartBarrier: Promise<void> | null;
  spawnWaitBarrier: Promise<void> | null;
  isPaused: boolean;
  stateBeforePause: Exclude<SourceState, 'paused'>;
  hasPlayed: boolean;
  inputEnded: boolean;
  mixerEpoch: number;
  positionBaseMilliseconds: number;
}

export const MAX_AMBIENCE_RESTARTS = 3;
export const AMBIENCE_RETRY_DELAY_MILLISECONDS = 1_000;

function clampVolume(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0.7));
}

function normalizeDuration(value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError('Audio duration must be a positive number of seconds or null.');
  }
  return value;
}

function durationMilliseconds(source: RuntimeSource): number | null {
  return source.public.duration === null ? null : Math.round(source.public.duration * 1_000);
}

function normalizePosition(value: number, duration: number | null, repeat: boolean): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError('Playback position must be a non-negative number of milliseconds.');
  }
  const position = Math.round(value);
  if (duration === null) return position;
  if (repeat) return duration === 0 ? 0 : position % duration;
  return Math.min(position, duration);
}

export class AudioEngine {
  readonly mixer = new PcmMixer();
  #sources = new Map<string, RuntimeSource>();
  #roleBarriers = new Map<AssetRole, Promise<void>>();
  #sourceEndedListeners = new Set<SourceEndedListener>();
  #destroyed = false;

  list(): ActiveSource[] {
    return [...this.#sources.values()]
      .map((source) => ({ ...source.public }))
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }

  getSource(id: string): ActiveSource {
    return { ...this.#requireSource(id).public };
  }

  onSourceEnded(listener: SourceEndedListener): () => void {
    this.#sourceEndedListeners.add(listener);
    return () => this.#sourceEndedListeners.delete(listener);
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
    pcm: Buffer | null = null,
    options: AudioPlaybackOptions = {}
  ): ActiveSource {
    const repeat = options.repeat ?? role === 'ambience';
    const duration = normalizeDuration(
      options.duration === undefined ? asset.duration : options.duration
    );
    const initialPosition = normalizePosition(
      options.offsetMilliseconds ?? 0,
      duration === null ? null : Math.round(duration * 1_000),
      repeat
    );
    return this.#start({
      label: asset.name,
      path,
      pcm: role === 'soundboard' ? pcm : null,
      role,
      volume,
      duration,
      repeat,
      positionMilliseconds: initialPosition,
      assetId: asset.id
    });
  }

  setSourceVolume(id: string, volume: number): ActiveSource {
    const source = this.#requireSource(id);
    source.public.volume = clampVolume(volume);
    this.mixer.setInputVolume(id, source.public.volume);
    return { ...source.public };
  }

  pause(id: string): ActiveSource {
    const source = this.#requireSource(id);
    if (source.public.state === 'failed') {
      throw new Error('A failed source cannot be paused.');
    }
    if (source.isPaused || source.public.state === 'paused') return { ...source.public };
    source.isPaused = true;
    source.stateBeforePause = source.public.state;
    source.public.state = 'paused';
    this.mixer.setInputPaused(id, true);
    return { ...source.public };
  }

  resume(id: string): ActiveSource {
    const source = this.#requireSource(id);
    if (!source.isPaused) return { ...source.public };
    source.isPaused = false;
    this.mixer.setInputPaused(id, false);

    if (source.inputEnded) {
      source.public.state = source.public.error ? 'failed' : 'playing';
      return { ...source.public };
    }
    if (source.restartTimer) {
      source.public.state = 'restarting';
      return { ...source.public };
    }
    if (source.decoder) {
      source.public.state = source.hasPlayed
        ? 'playing'
        : source.stateBeforePause === 'restarting'
          ? 'restarting'
          : 'starting';
      return { ...source.public };
    }

    source.public.state = source.stateBeforePause === 'restarting' ? 'restarting' : 'starting';
    this.#requestSpawn(source);
    return { ...source.public };
  }

  seek(id: string, positionMilliseconds: number): Promise<ActiveSource> {
    return this.updateSourceTransport(id, { positionMilliseconds });
  }

  setRepeat(id: string, repeat: boolean): Promise<ActiveSource> {
    return this.updateSourceTransport(id, { repeat });
  }

  async updateSourceTransport(id: string, input: AudioTransportUpdate): Promise<ActiveSource> {
    const source = this.#requireSource(id);
    const nextRepeat = input.repeat ?? source.public.repeat;
    const nextPosition = normalizePosition(
      input.positionMilliseconds ?? source.public.positionMilliseconds,
      durationMilliseconds(source),
      nextRepeat
    );
    const repeatChanged = nextRepeat !== source.public.repeat;
    const positionChanged = input.positionMilliseconds !== undefined;
    if (!repeatChanged && !positionChanged) return { ...source.public };

    source.public.repeat = nextRepeat;
    await this.#restartFrom(source, nextPosition);
    return { ...this.#requireSource(id).public };
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
    this.#sourceEndedListeners.clear();
    this.mixer.destroy();
  }

  #requireSource(id: string): RuntimeSource {
    const source = this.#sources.get(id);
    if (!source) throw new Error('Active source not found.');
    return source;
  }

  #start(input: {
    label: string;
    path: string;
    pcm: Buffer | null;
    role: AssetRole;
    volume: number;
    duration: number | null;
    repeat: boolean;
    positionMilliseconds: number;
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
        duration: input.duration,
        positionMilliseconds: input.positionMilliseconds,
        repeat: input.repeat,
        ...(input.assetId ? { assetId: input.assetId } : {})
      },
      path: input.path,
      pcm: input.pcm,
      decoder: null,
      generation: 0,
      restartAttempts: 0,
      restartTimer: null,
      startBarrier: null,
      restartBarrier: null,
      spawnWaitBarrier: null,
      isPaused: false,
      stateBeforePause: 'starting',
      hasPlayed: false,
      inputEnded: false,
      mixerEpoch: 0,
      positionBaseMilliseconds: input.positionMilliseconds
    };
    this.#sources.set(id, source);
    this.#addMixerInput(source);

    const canStartFromPcm = this.#canUsePcm(source);
    if (canStartFromPcm) {
      if (pendingBarrier || stopping.length > 0) this.#extendRoleBarrier(input.role, stopping);
    } else if (!pendingBarrier && stopping.length === 0) {
      // No activation barrier is necessary.
    } else {
      source.startBarrier = this.#extendRoleBarrier(input.role, stopping);
    }
    this.#requestSpawn(source);
    return { ...source.public };
  }

  #requestSpawn(source: RuntimeSource): void {
    if (
      this.#destroyed ||
      this.#sources.get(source.public.id) !== source ||
      source.isPaused ||
      source.decoder ||
      source.inputEnded ||
      source.restartTimer
    ) {
      return;
    }

    const barrier = source.startBarrier ?? source.restartBarrier;
    if (barrier) {
      if (source.spawnWaitBarrier === barrier) return;
      source.spawnWaitBarrier = barrier;
      void barrier.then(() => {
        if (source.startBarrier === barrier) source.startBarrier = null;
        if (source.restartBarrier === barrier) source.restartBarrier = null;
        if (source.spawnWaitBarrier === barrier) source.spawnWaitBarrier = null;
        this.#requestSpawn(source);
      });
      return;
    }

    this.#spawn(source);
  }

  #spawn(source: RuntimeSource): void {
    if (
      this.#destroyed ||
      this.#sources.get(source.public.id) !== source ||
      source.isPaused ||
      source.decoder
    ) {
      return;
    }
    const generation = ++source.generation;
    source.inputEnded = false;
    source.hasPlayed = false;
    source.public.state = source.stateBeforePause === 'restarting' ? 'restarting' : 'starting';
    delete source.public.error;

    const callbacks: DecoderCallbacks = {
      onData: (chunk) => {
        return source.generation === generation && this.mixer.append(source.public.id, chunk);
      },
      onPlaying: () => {
        if (source.generation !== generation) return;
        source.hasPlayed = true;
        delete source.public.error;
        if (!source.isPaused) source.public.state = 'playing';
      },
      onEnd: (error) => {
        if (source.generation !== generation || !this.#sources.has(source.public.id)) return;
        source.decoder = null;
        if (!source.public.repeat) {
          this.#finishOneShot(source, error);
          return;
        }
        this.#handleRepeatingEnd(source, error);
      }
    };

    if (this.#canUsePcm(source)) {
      const startByte = Math.min(
        source.pcm!.length,
        Math.floor((source.positionBaseMilliseconds * PCM_BYTES_PER_MILLISECOND) / 4) * 4
      );
      source.decoder = spawnPcmBufferDecoder(source.pcm!.subarray(startByte), callbacks);
      return;
    }

    const decoderInput: DecoderInput = {
      path: source.path,
      loop: source.public.repeat,
      ...(source.positionBaseMilliseconds > 0
        ? { startMilliseconds: source.positionBaseMilliseconds }
        : {})
    };
    source.decoder = spawnDecoder(decoderInput, callbacks);
  }

  #canUsePcm(source: RuntimeSource): boolean {
    return source.pcm !== null && !source.public.repeat;
  }

  #finishOneShot(source: RuntimeSource, error: string | null): void {
    source.inputEnded = true;
    if (error) {
      source.public.state = 'failed';
      source.public.error = error;
    }
    const finish = () => {
      if (this.#sources.get(source.public.id) !== source) return;
      if (!error) {
        const completed = { ...source.public };
        void this.#detach(source);
        this.#emitSourceEnded({ source: completed, reason: 'completed' });
        return;
      }
      const cleanup = setTimeout(() => this.stop(source.public.id), 5_000);
      cleanup.unref();
      source.restartTimer = cleanup;
    };
    if (!this.mixer.endInput(source.public.id, finish)) finish();
  }

  #handleRepeatingEnd(source: RuntimeSource, error: string | null): void {
    this.mixer.removeInput(source.public.id);
    const message = error ?? 'The repeating decoder ended unexpectedly.';
    if (source.restartAttempts >= MAX_AMBIENCE_RESTARTS) {
      source.public.state = 'failed';
      source.public.error = message;
      return;
    }

    source.restartAttempts += 1;
    source.stateBeforePause = 'restarting';
    if (!source.isPaused) source.public.state = 'restarting';
    source.public.error = message;
    this.#setPositionBase(source, source.public.positionMilliseconds);
    this.#addMixerInput(source);
    source.restartTimer = setTimeout(() => {
      source.restartTimer = null;
      if (this.#sources.get(source.public.id) !== source) return;
      this.#requestSpawn(source);
    }, AMBIENCE_RETRY_DELAY_MILLISECONDS);
    source.restartTimer.unref();
  }

  async #restartFrom(source: RuntimeSource, positionMilliseconds: number): Promise<void> {
    source.generation += 1;
    if (source.restartTimer) clearTimeout(source.restartTimer);
    source.restartTimer = null;
    const decoder = source.decoder;
    source.decoder = null;
    source.inputEnded = false;
    source.hasPlayed = false;
    source.restartAttempts = 0;
    source.stateBeforePause = 'starting';
    source.public.state = source.isPaused ? 'paused' : 'starting';
    delete source.public.error;
    this.#setPositionBase(source, positionMilliseconds);
    this.mixer.removeInput(source.public.id);
    this.#addMixerInput(source);

    const previous = source.restartBarrier ?? Promise.resolve();
    const stopping = decoder?.stop().catch(() => undefined) ?? Promise.resolve();
    const barrier = Promise.all([previous, stopping]).then(() => undefined);
    source.restartBarrier = barrier;
    this.#requestSpawn(source);
    await barrier;
    if (source.restartBarrier === barrier) source.restartBarrier = null;
    this.#requestSpawn(source);
  }

  #setPositionBase(source: RuntimeSource, positionMilliseconds: number): void {
    source.positionBaseMilliseconds = normalizePosition(
      positionMilliseconds,
      durationMilliseconds(source),
      source.public.repeat
    );
    source.public.positionMilliseconds = source.positionBaseMilliseconds;
  }

  #addMixerInput(source: RuntimeSource): void {
    const epoch = ++source.mixerEpoch;
    this.mixer.addInput(
      source.public.id,
      source.public.volume,
      () => source.decoder?.resume(),
      (_bytes, totalBytes) => {
        if (this.#sources.get(source.public.id) !== source || source.mixerEpoch !== epoch) {
          return;
        }
        const elapsed = totalBytes / PCM_BYTES_PER_MILLISECOND;
        source.public.positionMilliseconds = normalizePosition(
          Math.floor(source.positionBaseMilliseconds + elapsed),
          durationMilliseconds(source),
          source.public.repeat
        );
      }
    );
    this.mixer.setInputPaused(source.public.id, source.isPaused);
  }

  #detach(source: RuntimeSource): Promise<void> {
    this.#sources.delete(source.public.id);
    source.generation += 1;
    if (source.restartTimer) clearTimeout(source.restartTimer);
    source.restartTimer = null;
    const decoder = source.decoder;
    source.decoder = null;
    this.mixer.removeInput(source.public.id);
    const stopping = decoder?.stop().catch(() => undefined) ?? Promise.resolve();
    return Promise.all([
      source.startBarrier ?? Promise.resolve(),
      source.restartBarrier ?? Promise.resolve(),
      stopping
    ]).then(() => undefined);
  }

  #emitSourceEnded(event: SourceEndedEvent): void {
    for (const listener of this.#sourceEndedListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error(
          `Audio source-ended listener: ${
            error instanceof Error ? error.message : 'unknown listener error'
          }`
        );
      }
    }
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
