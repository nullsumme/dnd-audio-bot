import { describe, expect, it, vi } from 'vitest';
import type { AudioAsset } from '$lib/types';
import {
  buildPcmDecodeArgs,
  SoundboardPcmCache,
  type DecodedPcm,
  type SoundboardPcmCacheOptions
} from './pcm-cache';

function asset(id: string, duration = 0.1, role: 'ambience' | 'soundboard' = 'soundboard') {
  const timestamp = '2026-07-27T00:00:00.000Z';
  return {
    id,
    name: id,
    category: 'Effects',
    role,
    filename: `${id}.mp3`,
    originalFilename: `${id}.mp3`,
    mimeType: 'audio/mpeg',
    size: 1_000,
    duration,
    createdAt: timestamp,
    updatedAt: timestamp
  } satisfies AudioAsset;
}

function cache(options: SoundboardPcmCacheOptions = {}) {
  return new SoundboardPcmCache({
    maxBytes: 50_000,
    maxEntryBytes: 40_000,
    ...options
  });
}

function decoded(pcm: Buffer): DecodedPcm {
  return { pcm, allocationBytes: pcm.length };
}

describe('SoundboardPcmCache', () => {
  it('normalizes with bounded low-latency FFmpeg arguments', () => {
    const args = buildPcmDecodeArgs('/data/toy.mp3');
    const inputIndex = args.indexOf('-i');

    expect(args.slice(0, inputIndex)).toEqual([
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
      '1'
    ]);
    expect(args.slice(inputIndex)).toEqual([
      '-i',
      '/data/toy.mp3',
      '-map',
      '0:a:0',
      '-vn',
      '-ac',
      '2',
      '-ar',
      '48000',
      '-acodec',
      'pcm_s16le',
      '-f',
      's16le',
      'pipe:1'
    ]);
    expect(args).not.toContain('+nobuffer');
  });

  it('warms once, serves a cache hit, and reports bounded memory', async () => {
    const pcm = Buffer.alloc(20_000, 7);
    const decode = vi.fn(async () => decoded(pcm));
    const subject = cache({ decode });

    await expect(subject.prepare(asset('toy'), '/data/toy.mp3')).resolves.toBe(true);
    await expect(subject.prepare(asset('toy'), '/data/toy.mp3')).resolves.toBe(true);

    expect(decode).toHaveBeenCalledTimes(1);
    expect(subject.get('toy')).toBe(pcm);
    expect(subject.status()).toMatchObject({
      entries: 1,
      bytes: pcm.length,
      hits: 1,
      misses: 0,
      failures: 0
    });
  });

  it('serializes duplicate warm requests and contains decode failures', async () => {
    let release: (pcm: DecodedPcm) => void = () => {};
    const decode = vi.fn(
      () =>
        new Promise<DecodedPcm>((resolve) => {
          release = resolve;
        })
    );
    const subject = cache({ decode });
    const first = subject.prepare(asset('toy'), '/data/toy.mp3');
    const second = subject.prepare(asset('toy'), '/data/toy.mp3');

    await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(1));
    release(decoded(Buffer.alloc(20_000)));
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);

    const failing = cache({
      decode: vi.fn(async () => {
        throw new Error('decoder unavailable');
      })
    });
    await expect(failing.prepare(asset('broken'), '/data/broken.mp3')).resolves.toBe(false);
    expect(failing.status().failures).toBe(1);
  });

  it('waits for an in-flight warm before serving an immediate first click', async () => {
    const pcm = Buffer.alloc(20_000, 3);
    let release: (pcm: DecodedPcm) => void = () => {};
    const decode = vi.fn(
      () =>
        new Promise<DecodedPcm>((resolve) => {
          release = resolve;
        })
    );
    const subject = cache({ decode });
    const warming = subject.prepare(asset('toy'), '/data/toy.mp3');
    const click = subject.getOrPrepare(asset('toy'), '/data/toy.mp3', 1_000);

    await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(1));
    release(decoded(pcm));

    await expect(warming).resolves.toBe(true);
    await expect(click).resolves.toBe(pcm);
    expect(decode).toHaveBeenCalledTimes(1);
    expect(subject.status()).toMatchObject({ hits: 1, misses: 0 });
  });

  it('falls back within its wait budget while a cold cache entry keeps warming', async () => {
    const pcm = Buffer.alloc(20_000, 6);
    let release: (pcm: DecodedPcm) => void = () => {};
    const decode = vi.fn(
      () =>
        new Promise<DecodedPcm>((resolve) => {
          release = resolve;
        })
    );
    const subject = cache({ decode });

    await expect(subject.getOrPrepare(asset('toy'), '/data/toy.mp3', 0)).resolves.toBeNull();
    await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(1));
    release(decoded(pcm));
    await expect(subject.prepare(asset('toy'), '/data/toy.mp3')).resolves.toBe(true);

    expect(subject.get('toy')).toBe(pcm);
    expect(subject.status()).toMatchObject({ hits: 1, misses: 1 });
  });

  it('skips oversized or non-soundboard assets without decoding', async () => {
    const decode = vi.fn(async () => decoded(Buffer.alloc(4)));
    const subject = cache({ maxEntryBytes: 20_000, decode });

    await expect(subject.prepare(asset('long', 10), '/data/long.mp3')).resolves.toBe(false);
    await expect(
      subject.prepare(asset('ambience', 0.01, 'ambience'), '/data/ambience.mp3')
    ).resolves.toBe(false);

    expect(decode).not.toHaveBeenCalled();
    expect(subject.status().oversized).toBe(1);
  });

  it('preserves admitted entries and rejects work beyond the aggregate reservation', async () => {
    const firstPcm = Buffer.alloc(30_000, 1);
    const decode = vi.fn(async () => decoded(firstPcm));
    const subject = cache({ decode });

    await expect(subject.prepare(asset('first'), '/data/first.mp3')).resolves.toBe(true);
    await expect(subject.prepare(asset('second'), '/data/second.mp3')).resolves.toBe(false);

    expect(subject.get('first')).toEqual(firstPcm);
    expect(subject.get('second')).toBeNull();
    expect(decode).toHaveBeenCalledTimes(1);
    expect(subject.status()).toMatchObject({ evictions: 0, oversized: 1 });
  });

  it('rejects decoder output outside its reserved allocation', async () => {
    const subject = cache({
      decode: vi.fn(async () => decoded(Buffer.alloc(41_000)))
    });

    await expect(subject.prepare(asset('too-large', 0.01), '/data/too-large.mp3')).resolves.toBe(
      false
    );
    expect(subject.status()).toMatchObject({ entries: 0, bytes: 0, failures: 1 });
  });

  it('invalidates entries without affecting in-flight buffer readers', async () => {
    const pcm = Buffer.alloc(20_000, 4);
    const subject = cache({ decode: vi.fn(async () => decoded(pcm)) });
    await subject.prepare(asset('toy'), '/data/toy.mp3');
    const active = subject.get('toy');

    subject.remove('toy');

    expect(subject.get('toy')).toBeNull();
    expect(active).toEqual(pcm);
    expect(subject.status().bytes).toBe(0);
  });

  it('does not publish a cache entry after invalidation during a warm', async () => {
    let release: (pcm: DecodedPcm) => void = () => {};
    const subject = cache({
      decode: vi.fn(
        () =>
          new Promise<DecodedPcm>((resolve) => {
            release = resolve;
          })
      )
    });
    const warming = subject.prepare(asset('toy'), '/data/toy.mp3');
    await vi.waitFor(() => expect(subject.status().warming).toBe(1));

    subject.remove('toy');
    release(decoded(Buffer.alloc(20_000)));

    await expect(warming).resolves.toBe(false);
    expect(subject.get('toy')).toBeNull();
    expect(subject.status().bytes).toBe(0);
  });

  it('cancels an active warm when its asset is removed', async () => {
    let aborted = false;
    const subject = cache({
      decode: vi.fn(
        (_path, _maxBytes, signal) =>
          new Promise<DecodedPcm>((_resolve, reject) => {
            signal?.addEventListener(
              'abort',
              () => {
                aborted = true;
                reject(new Error('cancelled'));
              },
              { once: true }
            );
          })
      )
    });
    const warming = subject.prepare(asset('toy'), '/data/toy.mp3');
    await vi.waitFor(() => expect(subject.status().reservedBytes).toBeGreaterThan(0));

    subject.remove('toy');

    await expect(warming).resolves.toBe(false);
    expect(aborted).toBe(true);
    expect(subject.status()).toMatchObject({ failures: 0, reservedBytes: 0 });
  });

  it('aborts and awaits an active decode during shutdown', async () => {
    let aborted = false;
    const subject = cache({
      decode: vi.fn(
        (_path, _maxBytes, signal) =>
          new Promise<DecodedPcm>((_resolve, reject) => {
            signal?.addEventListener(
              'abort',
              () => {
                aborted = true;
                reject(new Error('cancelled'));
              },
              { once: true }
            );
          })
      )
    });
    const warming = subject.prepare(asset('toy'), '/data/toy.mp3');
    await vi.waitFor(() => expect(subject.status().reservedBytes).toBeGreaterThan(0));

    await subject.shutdown();

    await expect(warming).resolves.toBe(false);
    expect(aborted).toBe(true);
    expect(subject.status()).toMatchObject({ entries: 0, bytes: 0, reservedBytes: 0 });
  });
});
