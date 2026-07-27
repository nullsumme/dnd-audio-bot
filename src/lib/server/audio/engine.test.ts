import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioAsset } from '$lib/types';

interface CapturedDecoder {
  input: { kind: 'file'; path: string; loop: boolean } | { kind: 'youtube'; url: string };
  callbacks: {
    onData(chunk: Buffer): void;
    onPlaying(): void;
    onEnd(error: string | null): void;
  };
  stopped: boolean;
}

const captured = vi.hoisted(() => ({
  decoders: [] as CapturedDecoder[]
}));

vi.mock('./decoder', () => ({
  spawnDecoder: (
    input: CapturedDecoder['input'],
    callbacks: CapturedDecoder['callbacks']
  ): { stop(): void } => {
    const decoder: CapturedDecoder = { input, callbacks, stopped: false };
    captured.decoders.push(decoder);
    return {
      stop() {
        decoder.stopped = true;
      }
    };
  }
}));

import { AudioEngine } from './engine';

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

  it('keeps multiple ambience sources and overlapping one-shots active together', () => {
    const rain = engine.playAsset(asset('Rain', 'ambience'), '/data/rain.mp3', 'ambience');
    const tavern = engine.playYouTube({ url: 'https://youtu.be/tavern', title: 'Tavern' });
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

    expect(new Set(engine.list().map((source) => source.id)).size).toBe(4);
    expect(engine.list().filter((source) => source.role === 'ambience')).toHaveLength(2);
    expect(engine.list().filter((source) => source.role === 'soundboard')).toHaveLength(2);
    expect(thunderOne.id).not.toBe(thunderTwo.id);
    expect(captured.decoders.map((decoder) => decoder.input)).toEqual([
      { kind: 'file', path: '/data/rain.mp3', loop: true },
      { kind: 'youtube', url: 'https://youtu.be/tavern' },
      { kind: 'file', path: '/data/thunder.mp3', loop: false },
      { kind: 'file', path: '/data/thunder.mp3', loop: false }
    ]);

    captured.decoders[2].callbacks.onEnd(null);
    expect(engine.list().map((source) => source.id)).toEqual(
      expect.arrayContaining([rain.id, tavern.id, thunderTwo.id])
    );
    expect(engine.list().some((source) => source.id === thunderOne.id)).toBe(false);
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
      kind: 'file',
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
    engine.playYouTube({ url: 'https://youtu.be/rain', title: 'Rain' });

    expect(engine.stopByAsset(shared.id)).toBe(2);
    expect(engine.list()).toMatchObject([{ origin: 'youtube', label: 'Rain' }]);
    expect(captured.decoders.slice(0, 2).every((decoder) => decoder.stopped)).toBe(true);
  });
});
