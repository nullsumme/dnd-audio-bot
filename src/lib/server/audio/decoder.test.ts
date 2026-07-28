import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeChild extends EventEmitter {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  killed: boolean;
  exitCode: number | null;
  kill: ReturnType<typeof vi.fn>;
}

const fakes = vi.hoisted(() => ({
  children: [] as FakeChild[]
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: vi.fn(() => {
      const child = new EventEmitter() as FakeChild;
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.killed = false;
      child.exitCode = null;
      child.kill = vi.fn(() => {
        child.killed = true;
        return true;
      });
      fakes.children.push(child);
      return child;
    })
  };
});

import { spawnDecoder } from './decoder';

describe('spawnDecoder local MP3 playback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakes.children.length = 0;
  });

  it('pauses FFmpeg output on mixer backpressure and resumes on demand', () => {
    const callbacks = {
      onData: vi.fn(() => false),
      onPlaying: vi.fn(),
      onEnd: vi.fn()
    };
    const decoder = spawnDecoder({ path: '/data/forest.mp3', loop: true }, callbacks);
    const [ffmpeg] = fakes.children;

    ffmpeg.stdout.emit('data', Buffer.alloc(4_096));
    expect(ffmpeg.stdout.isPaused()).toBe(true);

    decoder.resume();
    expect(ffmpeg.stdout.isPaused()).toBe(false);
  });
});
