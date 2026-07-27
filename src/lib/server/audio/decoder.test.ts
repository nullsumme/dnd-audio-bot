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

describe('spawnDecoder YouTube teardown', () => {
  beforeEach(() => {
    fakes.children.length = 0;
  });

  it('handles a buffered EPIPE and detaches yt-dlp before stopping both processes', () => {
    const callbacks = {
      onData: vi.fn(),
      onPlaying: vi.fn(),
      onEnd: vi.fn()
    };
    const decoder = spawnDecoder({ kind: 'youtube', url: 'https://youtu.be/example' }, callbacks);
    const [ffmpeg, ytdlp] = fakes.children;
    const unpipe = vi.spyOn(ytdlp.stdout, 'unpipe');
    const brokenPipe = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });

    expect(() => ffmpeg.stdin.emit('error', brokenPipe)).not.toThrow();
    decoder.stop();

    expect(unpipe).toHaveBeenCalledWith(ffmpeg.stdin);
    expect(ytdlp.kill).toHaveBeenCalledWith('SIGTERM');
    expect(ffmpeg.kill).toHaveBeenCalledWith('SIGTERM');
    expect(callbacks.onEnd).not.toHaveBeenCalled();
  });
});
