import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';

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

describe('spawnDecoder YouTube media resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakes.children.length = 0;
  });

  it('resolves a media URL and asks FFmpeg to loop it without restarting yt-dlp', () => {
    const callbacks = {
      onData: vi.fn(),
      onPlaying: vi.fn(),
      onEnd: vi.fn()
    };
    const decoder = spawnDecoder({ kind: 'youtube', url: 'https://youtu.be/example' }, callbacks);
    const [resolver] = fakes.children;
    resolver.stdout.write('https://media.example/audio.webm\n');
    resolver.exitCode = 0;
    resolver.emit('close', 0);

    const ffmpeg = fakes.children[1];
    const ffmpegArgs = vi.mocked(spawn).mock.calls[1]?.[1];
    expect(ffmpegArgs).toEqual(
      expect.arrayContaining([
        '-stream_loop',
        '-1',
        '-re',
        '-i',
        'https://media.example/audio.webm'
      ])
    );

    decoder.stop();

    expect(ffmpeg.kill).toHaveBeenCalledWith('SIGTERM');
    expect(resolver.kill).not.toHaveBeenCalled();
    expect(callbacks.onEnd).not.toHaveBeenCalled();
  });

  it('stops yt-dlp cleanly while it is still resolving the media URL', () => {
    const callbacks = {
      onData: vi.fn(),
      onPlaying: vi.fn(),
      onEnd: vi.fn()
    };
    const decoder = spawnDecoder({ kind: 'youtube', url: 'https://youtu.be/example' }, callbacks);
    const [resolver] = fakes.children;

    decoder.stop();
    resolver.emit('close', null);

    expect(resolver.kill).toHaveBeenCalledWith('SIGTERM');
    expect(fakes.children).toHaveLength(1);
    expect(callbacks.onEnd).not.toHaveBeenCalled();
  });

  it('pauses FFmpeg output on mixer backpressure and resumes on demand', () => {
    const callbacks = {
      onData: vi.fn(() => false),
      onPlaying: vi.fn(),
      onEnd: vi.fn()
    };
    const decoder = spawnDecoder({ kind: 'file', path: '/data/forest.mp3', loop: true }, callbacks);
    const [ffmpeg] = fakes.children;

    ffmpeg.stdout.emit('data', Buffer.alloc(4_096));
    expect(ffmpeg.stdout.isPaused()).toBe(true);

    decoder.resume();
    expect(ffmpeg.stdout.isPaused()).toBe(false);
  });
});
