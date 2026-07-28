import { spawn } from 'node:child_process';
import type { AudioAsset, PcmCacheStatus } from '$lib/types';
import { config } from '../config';
import { terminateProcess } from '../process';
import { BYTES_PER_FRAME, CHANNELS, SAMPLE_RATE } from './mixer';

export const PCM_BYTES_PER_SECOND = SAMPLE_RATE * CHANNELS * 2;
export const PCM_ESTIMATE_SLACK_BYTES = BYTES_PER_FRAME * 4;
export const PCM_DECODE_TIMEOUT_MILLISECONDS = 30_000;
export const PCM_PLAYBACK_WAIT_MILLISECONDS = 20;

export interface DecodedPcm {
  pcm: Buffer;
  allocationBytes: number;
}

type DecodePcm = (path: string, maxBytes: number, signal?: AbortSignal) => Promise<DecodedPcm>;

interface CachedPcm extends DecodedPcm {}

export interface SoundboardPcmCacheOptions {
  maxBytes?: number;
  maxEntryBytes?: number;
  ffmpegPath?: string;
  decode?: DecodePcm;
}

export function buildPcmDecodeArgs(path: string): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-xerror',
    '-nostdin',
    '-probesize',
    '32768',
    '-analyzeduration',
    '0',
    '-threads',
    '1',
    '-filter_threads',
    '1',
    '-filter_complex_threads',
    '1',
    '-i',
    path,
    '-map',
    '0:a:0',
    '-vn',
    '-ac',
    `${CHANNELS}`,
    '-ar',
    `${SAMPLE_RATE}`,
    '-acodec',
    'pcm_s16le',
    '-f',
    's16le',
    'pipe:1'
  ];
}

function boundedLog(current: string, chunk: Buffer): string {
  return `${current}${chunk.toString('utf8')}`.slice(-4_000);
}

export function decodePcmFile(
  path: string,
  maxBytes: number,
  ffmpegPath = config.ffmpegPath,
  signal?: AbortSignal
): Promise<DecodedPcm> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    return Promise.reject(new Error('The PCM decode allocation is invalid.'));
  }

  return new Promise((resolve, reject) => {
    const allocation = Buffer.allocUnsafe(maxBytes);
    const ffmpeg = spawn(ffmpegPath, buildPcmDecodeArgs(path), {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let offset = 0;
    let stderr = '';
    let failure: Error | null = null;
    let settled = false;

    const fail = (error: Error) => {
      if (!failure) failure = error;
      terminateProcess(ffmpeg);
    };
    const onAbort = () => fail(new Error('PCM cache warming was cancelled.'));
    const timer = setTimeout(
      () => fail(new Error('PCM cache warming timed out.')),
      PCM_DECODE_TIMEOUT_MILLISECONDS
    );
    timer.unref();

    ffmpeg.stdout.on('data', (chunk: Buffer) => {
      if (failure) return;
      if (offset + chunk.length > allocation.length) {
        fail(new Error('Decoded PCM exceeds the reserved cache allocation.'));
        return;
      }
      chunk.copy(allocation, offset);
      offset += chunk.length;
    });
    ffmpeg.stderr.on('data', (chunk: Buffer) => {
      stderr = boundedLog(stderr, chunk);
    });
    ffmpeg.once('error', (error) => fail(error));
    ffmpeg.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);

      if (failure) {
        reject(failure);
        return;
      }
      if (code !== 0) {
        reject(
          new Error(stderr.trim() || `FFmpeg PCM decode exited with code ${code ?? 'unknown'}.`)
        );
        return;
      }
      if (offset === 0) {
        reject(new Error('FFmpeg produced no PCM audio.'));
        return;
      }
      if (offset % (CHANNELS * 2) !== 0) {
        reject(new Error('Decoded PCM is not sample-aligned.'));
        return;
      }
      resolve({
        pcm: allocation.subarray(0, offset),
        allocationBytes: allocation.length
      });
    });

    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export class SoundboardPcmCache {
  readonly maxBytes: number;
  readonly maxEntryBytes: number;

  #entries = new Map<string, CachedPcm>();
  #pending = new Map<string, { generation: number; promise: Promise<boolean> }>();
  #generations = new Map<string, number>();
  #decode: DecodePcm;
  #warmTail: Promise<void> = Promise.resolve();
  #controller: AbortController | null = null;
  #controllerAssetId: string | null = null;
  #bytes = 0;
  #reservedBytes = 0;
  #hits = 0;
  #misses = 0;
  #evictions = 0;
  #failures = 0;
  #oversized = 0;
  #shuttingDown = false;

  constructor(options: SoundboardPcmCacheOptions = {}) {
    this.maxBytes = Math.max(0, options.maxBytes ?? config.maxPcmCacheBytes);
    this.maxEntryBytes = Math.max(
      0,
      Math.min(options.maxEntryBytes ?? config.maxPcmCacheEntryBytes, this.maxBytes)
    );
    const ffmpegPath = options.ffmpegPath ?? config.ffmpegPath;
    this.#decode =
      options.decode ??
      ((path, maxBytes, signal) => decodePcmFile(path, maxBytes, ffmpegPath, signal));
  }

  status(): PcmCacheStatus {
    return {
      enabled: this.maxBytes > 0 && this.maxEntryBytes > 0,
      entries: this.#entries.size,
      bytes: this.#bytes,
      reservedBytes: this.#reservedBytes,
      maxBytes: this.maxBytes,
      maxEntryBytes: this.maxEntryBytes,
      warming: this.#pending.size,
      hits: this.#hits,
      misses: this.#misses,
      evictions: this.#evictions,
      failures: this.#failures,
      oversized: this.#oversized
    };
  }

  get(assetId: string): Buffer | null {
    const entry = this.#entries.get(assetId);
    if (!entry) {
      this.#misses += 1;
      return null;
    }
    this.#hits += 1;
    return entry.pcm;
  }

  async getOrPrepare(
    asset: AudioAsset,
    path: string,
    waitMilliseconds = PCM_PLAYBACK_WAIT_MILLISECONDS
  ): Promise<Buffer | null> {
    let entry = this.#entries.get(asset.id);
    if (!entry && waitMilliseconds > 0) {
      const warming = this.prepare(asset, path);
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        warming,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, waitMilliseconds);
          timer.unref();
        })
      ]);
      if (timer) clearTimeout(timer);
      entry = this.#entries.get(asset.id);
    } else if (!entry) {
      void this.prepare(asset, path);
    }

    if (!entry) {
      this.#misses += 1;
      return null;
    }
    this.#hits += 1;
    return entry.pcm;
  }

  prepare(asset: AudioAsset, path: string): Promise<boolean> {
    if (this.#shuttingDown || asset.role !== 'soundboard') return Promise.resolve(false);
    const allocationBytes = this.#allocationBytes(asset);
    if (allocationBytes === null) return Promise.resolve(false);
    if (this.#entries.has(asset.id)) return Promise.resolve(true);

    const generation = this.#generations.get(asset.id) ?? 0;
    const current = this.#pending.get(asset.id);
    if (current?.generation === generation) return current.promise;

    const pending = this.#warmTail
      .then(() => this.#prepareNow(asset, path, generation, allocationBytes))
      .catch((error: unknown) => {
        if (this.#shuttingDown || (this.#generations.get(asset.id) ?? 0) !== generation) {
          return false;
        }
        this.#failures += 1;
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Soundboard PCM cache warm failed for ${asset.name}: ${message}`);
        return false;
      })
      .finally(() => {
        if (this.#pending.get(asset.id)?.promise === pending) this.#pending.delete(asset.id);
      });
    this.#pending.set(asset.id, { generation, promise: pending });
    this.#warmTail = pending.then(() => undefined);
    return pending;
  }

  async prewarm(assets: AudioAsset[], pathFor: (asset: AudioAsset) => string): Promise<void> {
    for (const asset of assets) {
      if (this.#shuttingDown) return;
      if (asset.role === 'soundboard') await this.prepare(asset, pathFor(asset));
    }
  }

  remove(assetId: string): void {
    this.#generations.set(assetId, (this.#generations.get(assetId) ?? 0) + 1);
    if (this.#controllerAssetId === assetId) this.#controller?.abort();
    const entry = this.#entries.get(assetId);
    if (!entry) return;
    this.#entries.delete(assetId);
    this.#bytes -= entry.allocationBytes;
  }

  clear(): void {
    for (const assetId of new Set([...this.#entries.keys(), ...this.#pending.keys()])) {
      this.#generations.set(assetId, (this.#generations.get(assetId) ?? 0) + 1);
    }
    this.#entries.clear();
    this.#bytes = 0;
  }

  async shutdown(): Promise<void> {
    this.#shuttingDown = true;
    this.clear();
    this.#controller?.abort();
    await this.#warmTail;
  }

  #allocationBytes(asset: AudioAsset): number | null {
    if (
      this.maxBytes === 0 ||
      this.maxEntryBytes === 0 ||
      asset.duration === null ||
      !Number.isFinite(asset.duration) ||
      asset.duration <= 0
    ) {
      return null;
    }
    const estimatedBytes =
      Math.ceil(asset.duration * PCM_BYTES_PER_SECOND) + PCM_ESTIMATE_SLACK_BYTES;
    if (estimatedBytes <= this.maxEntryBytes) return estimatedBytes;
    this.#oversized += 1;
    return null;
  }

  async #prepareNow(
    asset: AudioAsset,
    path: string,
    generation: number,
    allocationBytes: number
  ): Promise<boolean> {
    if (
      this.#shuttingDown ||
      (this.#generations.get(asset.id) ?? 0) !== generation ||
      this.#entries.has(asset.id)
    ) {
      return this.#entries.has(asset.id);
    }
    if (this.#bytes + this.#reservedBytes + allocationBytes > this.maxBytes) {
      this.#oversized += 1;
      return false;
    }

    this.#reservedBytes += allocationBytes;
    const controller = new AbortController();
    this.#controller = controller;
    this.#controllerAssetId = asset.id;
    let decoded: DecodedPcm;
    try {
      decoded = await this.#decode(path, allocationBytes, controller.signal);
    } finally {
      if (this.#controller === controller) {
        this.#controller = null;
        this.#controllerAssetId = null;
      }
      this.#reservedBytes -= allocationBytes;
    }

    if (this.#shuttingDown || (this.#generations.get(asset.id) ?? 0) !== generation) {
      return false;
    }
    if (
      decoded.pcm.length === 0 ||
      decoded.pcm.length > decoded.allocationBytes ||
      decoded.allocationBytes > allocationBytes ||
      decoded.allocationBytes > this.maxEntryBytes ||
      decoded.pcm.length % (CHANNELS * 2) !== 0
    ) {
      throw new Error('Decoded PCM is outside the reserved cache bounds.');
    }
    if (this.#bytes + decoded.allocationBytes > this.maxBytes) {
      return false;
    }

    this.#entries.set(asset.id, decoded);
    this.#bytes += decoded.allocationBytes;
    return true;
  }
}
