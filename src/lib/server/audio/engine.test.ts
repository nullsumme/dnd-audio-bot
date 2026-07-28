import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioAsset } from '$lib/types';

interface CapturedDecoder {
  input: { path: string; loop: boolean };
  callbacks: {
    onData(chunk: Buffer): boolean;
    onPlaying(): void;
    onEnd(error: string | null): void;
  };
  resumed: number;
  stopRequested: boolean;
  finishStop(): void;
}

interface CapturedPcmDecoder {
  pcm: Buffer;
  callbacks: CapturedDecoder['callbacks'];
  resumed: number;
  stopRequested: boolean;
}

const captured = vi.hoisted(() => ({
  decoders: [] as CapturedDecoder[],
  pcmDecoders: [] as CapturedPcmDecoder[]
}));

vi.mock('./decoder', () => ({
  spawnDecoder: (
    input: CapturedDecoder['input'],
    callbacks: CapturedDecoder['callbacks']
  ): { resume(): void; stop(): Promise<void> } => {
    let resolveStop: () => void = () => {};
    const stopped = new Promise<void>((resolve) => {
      resolveStop = resolve;
    });
    const decoder: CapturedDecoder = {
      input,
      callbacks,
      resumed: 0,
      stopRequested: false,
      finishStop: resolveStop
    };
    captured.decoders.push(decoder);
    return {
      resume() {
        decoder.resumed += 1;
      },
      async stop() {
        decoder.stopRequested = true;
        await stopped;
      }
    };
  }
}));

vi.mock('./pcm-buffer-decoder', () => ({
  spawnPcmBufferDecoder: (
    pcm: Buffer,
    callbacks: CapturedPcmDecoder['callbacks']
  ): { resume(): void; stop(): Promise<void> } => {
    const decoder: CapturedPcmDecoder = {
      pcm,
      callbacks,
      resumed: 0,
      stopRequested: false
    };
    captured.pcmDecoders.push(decoder);
    return {
      resume() {
        decoder.resumed += 1;
      },
      async stop() {
        decoder.stopRequested = true;
      }
    };
  }
}));

import { AMBIENCE_RETRY_DELAY_MILLISECONDS, AudioEngine, MAX_AMBIENCE_RESTARTS } from './engine';
import { BYTES_PER_FRAME, INPUT_HIGH_WATERMARK_BYTES } from './mixer';

function asset(id: string, role: 'ambience' | 'soundboard'): AudioAsset {
  const timestamp = '2026-07-27T00:00:00.000Z';
  return {
    id,
    name: id,
    category: role === 'ambience' ? 'Weather' : 'Effects',
    role,
    filename: `${id}.mp3`,
    originalFilename: `${id}.mp3`,
    mimeType: 'audio/mpeg',
    size: 1_024,
    duration: 10,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

describe('AudioEngine source lifecycle', () => {
  let engine: AudioEngine;

  beforeEach(() => {
    captured.decoders.length = 0;
    captured.pcmDecoders.length = 0;
    engine = new AudioEngine();
  });

  afterEach(async () => {
    engine.destroy();
    captured.decoders.forEach((decoder) => decoder.finishStop());
    await Promise.resolve();
    vi.useRealTimers();
  });

  it('keeps exactly one source on each mix line and waits for the replaced decoder to exit', async () => {
    const rain = engine.playAsset(asset('Rain', 'ambience'), '/data/rain.mp3', 'ambience');
    const tavern = engine.playAsset(asset('Tavern', 'ambience'), '/data/tavern.mp3', 'ambience');
    const thunder = engine.playAsset(
      asset('Thunder', 'soundboard'),
      '/data/thunder.mp3',
      'soundboard'
    );

    expect(engine.list()).toHaveLength(2);
    expect(engine.list().filter((source) => source.role === 'ambience')).toHaveLength(1);
    expect(engine.list().filter((source) => source.role === 'soundboard')).toHaveLength(1);
    expect(engine.list().some((source) => source.id === rain.id)).toBe(false);
    expect(captured.decoders).toHaveLength(2);
    expect(captured.decoders[0].stopRequested).toBe(true);
    expect(captured.decoders[1].input).toEqual({ path: '/data/thunder.mp3', loop: false });

    captured.decoders[0].finishStop();
    await vi.waitFor(() => expect(captured.decoders).toHaveLength(3));
    expect(captured.decoders[2].input).toEqual({ path: '/data/tavern.mp3', loop: true });

    captured.decoders[1].callbacks.onEnd(null);
    expect(engine.list()).toMatchObject([{ id: tavern.id, role: 'ambience' }]);
    expect(engine.list().some((source) => source.id === thunder.id)).toBe(false);
  });

  it('coalesces rapid same-role replacements before starting another FFmpeg process', async () => {
    const first = engine.playAsset(asset('First', 'soundboard'), '/data/first.mp3', 'soundboard');
    const second = engine.playAsset(
      asset('Second', 'soundboard'),
      '/data/second.mp3',
      'soundboard'
    );
    const third = engine.playAsset(asset('Third', 'soundboard'), '/data/third.mp3', 'soundboard');

    expect(first.id).not.toBe(second.id);
    expect(second.id).not.toBe(third.id);
    expect(captured.decoders).toHaveLength(1);
    expect(captured.decoders[0].stopRequested).toBe(true);

    captured.decoders[0].finishStop();
    await vi.waitFor(() => expect(captured.decoders).toHaveLength(2));
    expect(captured.decoders[1].input.path).toBe('/data/third.mp3');
    expect(engine.list()).toMatchObject([{ id: third.id }]);
  });

  it('starts cached effects immediately while retaining the FFmpeg replacement barrier', async () => {
    const first = engine.playAsset(asset('First', 'soundboard'), '/data/first.mp3', 'soundboard');
    const cachedPcm = Buffer.alloc(BYTES_PER_FRAME * 2);
    const cached = engine.playAsset(
      asset('Cached', 'soundboard'),
      '/data/cached.mp3',
      'soundboard',
      0.8,
      cachedPcm
    );

    expect(captured.decoders).toHaveLength(1);
    expect(captured.decoders[0].stopRequested).toBe(true);
    expect(captured.pcmDecoders).toMatchObject([{ pcm: cachedPcm }]);
    expect(engine.list()).toMatchObject([{ id: cached.id, state: 'starting' }]);
    expect(engine.list().some((source) => source.id === first.id)).toBe(false);

    const third = engine.playAsset(asset('Third', 'soundboard'), '/data/third.mp3', 'soundboard');
    expect(captured.pcmDecoders[0].stopRequested).toBe(true);
    expect(captured.decoders).toHaveLength(1);

    captured.decoders[0].finishStop();
    await vi.waitFor(() => expect(captured.decoders).toHaveLength(2));
    expect(captured.decoders[1].input.path).toBe('/data/third.mp3');
    expect(engine.list()).toMatchObject([{ id: third.id }]);
  });

  it('drains a one-shot final partial frame before removing its source', async () => {
    vi.useFakeTimers();
    // Discord starts the endless mixer before any library source, so consume the
    // one-time output lead as silence before exercising source lifecycle timing.
    engine.mixer.resume();
    await vi.advanceTimersByTimeAsync(0);
    const effect = engine.playAsset(asset('Sword', 'soundboard'), '/data/sword.mp3', 'soundboard');
    const decoder = captured.decoders[0];

    decoder.callbacks.onPlaying();
    decoder.callbacks.onData(Buffer.alloc(BYTES_PER_FRAME + 1_000));
    decoder.callbacks.onEnd(null);

    expect(engine.list()).toMatchObject([{ id: effect.id, state: 'playing' }]);
    await vi.advanceTimersByTimeAsync(20);
    expect(engine.list()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(20);
    expect(engine.list()).toEqual([]);
    expect(engine.mixer.diagnostics.finalPartialFramesPadded).toBe(1);
  });

  it('opens the ambience circuit after bounded decoder failures', async () => {
    vi.useFakeTimers();
    const ambience = engine.playAsset(asset('Forest', 'ambience'), '/data/forest.mp3', 'ambience');

    for (let attempt = 0; attempt < MAX_AMBIENCE_RESTARTS; attempt += 1) {
      captured.decoders[attempt].callbacks.onEnd('invalid MP3');
      expect(engine.list()).toMatchObject([{ id: ambience.id, state: 'restarting' }]);
      await vi.advanceTimersByTimeAsync(AMBIENCE_RETRY_DELAY_MILLISECONDS);
      expect(captured.decoders).toHaveLength(attempt + 2);
      expect(captured.decoders.at(-1)?.input).toEqual({
        path: '/data/forest.mp3',
        loop: true
      });
    }

    captured.decoders.at(-1)!.callbacks.onEnd('invalid MP3');
    expect(engine.list()).toMatchObject([
      { id: ambience.id, state: 'failed', error: 'invalid MP3' }
    ]);
    await vi.advanceTimersByTimeAsync(AMBIENCE_RETRY_DELAY_MILLISECONDS * 10);
    expect(captured.decoders).toHaveLength(MAX_AMBIENCE_RESTARTS + 1);
  });

  it('stops all sources associated with a deleted library asset', async () => {
    const shared = asset('Storm', 'soundboard');
    engine.playAsset(shared, '/data/storm.mp3', 'soundboard');
    engine.playAsset(shared, '/data/storm.mp3', 'soundboard');
    engine.playAsset(asset('Rain', 'ambience'), '/data/rain.mp3', 'ambience');

    expect(engine.stopByAsset(shared.id)).toBe(1);
    expect(engine.list()).toMatchObject([{ label: 'Rain' }]);
    expect(captured.decoders[0].stopRequested).toBe(true);
    expect(captured.decoders[1].stopRequested).toBe(false);
    captured.decoders[0].finishStop();
    await Promise.resolve();
    expect(captured.decoders).toHaveLength(2);
  });

  it('backpressures a decoder without dropping buffered PCM and resumes after draining', async () => {
    vi.useFakeTimers();
    engine.playAsset(asset('Forest', 'ambience'), '/data/forest.mp3', 'ambience');
    const decoder = captured.decoders[0];
    const pcm = Buffer.alloc(INPUT_HIGH_WATERMARK_BYTES + BYTES_PER_FRAME);

    expect(decoder.callbacks.onData(pcm)).toBe(false);
    expect(engine.mixer.bufferedBytes(engine.list()[0].id)).toBe(pcm.length);

    engine.mixer.resume();
    await vi.advanceTimersByTimeAsync(400);

    expect(decoder.resumed).toBe(1);
  });
});
