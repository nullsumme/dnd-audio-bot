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
  stopped: boolean;
}

const captured = vi.hoisted(() => ({
  decoders: [] as CapturedDecoder[]
}));

vi.mock('./decoder', () => ({
  spawnDecoder: (
    input: CapturedDecoder['input'],
    callbacks: CapturedDecoder['callbacks']
  ): { resume(): void; stop(): void } => {
    const decoder: CapturedDecoder = { input, callbacks, resumed: 0, stopped: false };
    captured.decoders.push(decoder);
    return {
      resume() {
        decoder.resumed += 1;
      },
      stop() {
        decoder.stopped = true;
      }
    };
  }
}));

import { AudioEngine } from './engine';
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
    engine = new AudioEngine();
  });

  afterEach(() => {
    engine.destroy();
    vi.useRealTimers();
  });

  it('keeps exactly one source on each mix line and replaces only that line', () => {
    const rain = engine.playAsset(asset('Rain', 'ambience'), '/data/rain.mp3', 'ambience');
    const tavern = engine.playAsset(asset('Tavern', 'ambience'), '/data/tavern.mp3', 'ambience');
    const thunderOne = engine.playAsset(
      asset('Thunder', 'soundboard'),
      '/data/thunder.mp3',
      'soundboard'
    );
    const thunderTwo = engine.playAsset(
      asset('Thunder', 'soundboard'),
      '/data/thunder.mp3',
      'soundboard'
    );

    expect(engine.list()).toHaveLength(2);
    expect(engine.list().filter((source) => source.role === 'ambience')).toHaveLength(1);
    expect(engine.list().filter((source) => source.role === 'soundboard')).toHaveLength(1);
    expect(thunderOne.id).not.toBe(thunderTwo.id);
    expect(engine.list().some((source) => source.id === rain.id)).toBe(false);
    expect(engine.list().some((source) => source.id === thunderOne.id)).toBe(false);
    expect(captured.decoders[0].stopped).toBe(true);
    expect(captured.decoders[2].stopped).toBe(true);
    expect(captured.decoders.map((decoder) => decoder.input)).toEqual([
      { path: '/data/rain.mp3', loop: true },
      { path: '/data/tavern.mp3', loop: true },
      { path: '/data/thunder.mp3', loop: false },
      { path: '/data/thunder.mp3', loop: false }
    ]);

    captured.decoders[3].callbacks.onEnd(null);
    expect(engine.list()).toMatchObject([{ id: tavern.id, role: 'ambience' }]);
  });

  it('restarts ambience after EOF while one-shots remove themselves', async () => {
    vi.useFakeTimers();
    const ambience = engine.playAsset(asset('Forest', 'ambience'), '/data/forest.mp3', 'ambience');
    const effect = engine.playAsset(asset('Sword', 'soundboard'), '/data/sword.mp3', 'soundboard');

    captured.decoders[0].callbacks.onPlaying();
    captured.decoders[1].callbacks.onPlaying();
    expect(engine.list().find((source) => source.id === ambience.id)?.state).toBe('playing');

    captured.decoders[0].callbacks.onEnd(null);
    captured.decoders[1].callbacks.onEnd(null);
    expect(engine.list()).toMatchObject([{ id: ambience.id, state: 'restarting' }]);

    await vi.advanceTimersByTimeAsync(500);
    expect(captured.decoders).toHaveLength(3);
    expect(captured.decoders[2].input).toEqual({
      path: '/data/forest.mp3',
      loop: true
    });
    expect(engine.list()).toMatchObject([{ id: ambience.id, state: 'restarting' }]);
    captured.decoders[2].callbacks.onPlaying();
    expect(engine.list()).toMatchObject([{ id: ambience.id, state: 'playing' }]);
    expect(engine.list().some((source) => source.id === effect.id)).toBe(false);
  });

  it('stops all sources associated with a deleted library asset', () => {
    const shared = asset('Storm', 'soundboard');
    engine.playAsset(shared, '/data/storm.mp3', 'soundboard');
    engine.playAsset(shared, '/data/storm.mp3', 'soundboard');
    engine.playAsset(asset('Rain', 'ambience'), '/data/rain.mp3', 'ambience');

    expect(engine.stopByAsset(shared.id)).toBe(1);
    expect(engine.list()).toMatchObject([{ label: 'Rain' }]);
    expect(captured.decoders.slice(0, 2).every((decoder) => decoder.stopped)).toBe(true);
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
