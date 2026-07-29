import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeChild extends EventEmitter {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  killed: boolean;
  exitCode: number | null;
  kill: ReturnType<typeof vi.fn>;
}

const fakes = vi.hoisted(() => ({
  children: [] as FakeChild[],
  args: [] as string[][]
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: vi.fn((_command: string, args: string[]) => {
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
      fakes.args.push(args);
      return child;
    })
  };
});

import { DECODER_STOP_TIMEOUT_MILLISECONDS, spawnDecoder } from './decoder';

describe('spawnDecoder local MP3 playback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakes.children.length = 0;
    fakes.args.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses bounded probing and single-thread decoding without wall-clock throttling', () => {
    spawnDecoder(
      { path: '/data/forest.mp3', loop: true },
      {
        onData: () => true,
        onPlaying() {},
        onEnd() {}
      }
    );

    const args = fakes.args[0];
    const inputIndex = args.indexOf('-i');

    expect(args).not.toContain('-re');
    expect(args).not.toContain('+nobuffer');
    expect(inputIndex).toBeGreaterThan(0);
    expect(args.slice(0, inputIndex)).toEqual([
      '-hide_banner',
      '-loglevel',
      'warning',
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
      '-stream_loop',
      '-1'
    ]);
  });

  it('applies an input seek offset before decoding without changing loop behavior', () => {
    spawnDecoder(
      { path: '/data/forest.mp3', loop: false, startMilliseconds: 12_345 },
      {
        onData: () => true,
        onPlaying() {},
        onEnd() {}
      }
    );

    const args = fakes.args[0];
    expect(args.slice(args.indexOf('-filter_complex_threads') + 2, args.indexOf('-i'))).toEqual([
      '-ss',
      '12.345'
    ]);
    expect(args).not.toContain('-stream_loop');
  });

  it('rejects invalid decoder seek offsets before starting FFmpeg', () => {
    expect(() =>
      spawnDecoder(
        { path: '/data/forest.mp3', loop: false, startMilliseconds: -1 },
        {
          onData: () => true,
          onPlaying() {},
          onEnd() {}
        }
      )
    ).toThrow('non-negative integer');
    expect(fakes.children).toHaveLength(0);
  });

  it('reads complete PCM frames on demand and resumes after mixer backpressure', async () => {
    const callbacks = {
      onData: vi.fn(() => false),
      onPlaying: vi.fn(),
      onEnd: vi.fn()
    };
    const decoder = spawnDecoder({ path: '/data/forest.mp3', loop: true }, callbacks);
    const [ffmpeg] = fakes.children;

    ffmpeg.stdout.write(Buffer.alloc(3_840 * 2));
    await vi.waitFor(() => expect(callbacks.onData).toHaveBeenCalledTimes(1));
    expect(callbacks.onData).toHaveBeenLastCalledWith(Buffer.alloc(3_840));

    callbacks.onData.mockReturnValue(true);
    decoder.resume();
    await vi.waitFor(() => expect(callbacks.onData).toHaveBeenCalledTimes(2));
  });

  it('waits for paused stdout and its final partial frame before announcing EOF', async () => {
    const callbacks = {
      onData: vi.fn().mockReturnValueOnce(false).mockReturnValue(true),
      onPlaying: vi.fn(),
      onEnd: vi.fn()
    };
    const decoder = spawnDecoder({ path: '/data/toy.mp3', loop: false }, callbacks);
    const [ffmpeg] = fakes.children;
    const tail = Buffer.alloc(1_234, 7);

    ffmpeg.stdout.end(Buffer.concat([Buffer.alloc(3_840, 3), Buffer.alloc(3_840, 5), tail]));
    await vi.waitFor(() => expect(callbacks.onData).toHaveBeenCalledTimes(1));
    ffmpeg.emit('close', 0);
    expect(callbacks.onEnd).not.toHaveBeenCalled();

    decoder.resume();
    await vi.waitFor(() => expect(callbacks.onEnd).toHaveBeenCalledWith(null));
    expect(callbacks.onData).toHaveBeenCalledTimes(3);
    expect(callbacks.onData.mock.calls.map(([chunk]) => chunk.length)).toEqual([
      3_840, 3_840, 1_234
    ]);
  });

  it('settles an explicit stop on process exit without waiting for backpressured stdout close', async () => {
    const callbacks = {
      onData: vi.fn(() => false),
      onPlaying: vi.fn(),
      onEnd: vi.fn()
    };
    const decoder = spawnDecoder({ path: '/data/tavern.mp3', loop: true }, callbacks);
    const [ffmpeg] = fakes.children;

    ffmpeg.stdout.write(Buffer.alloc(3_840 * 2));
    await vi.waitFor(() => expect(callbacks.onData).toHaveBeenCalledTimes(1));
    ffmpeg.kill.mockImplementationOnce(() => {
      ffmpeg.killed = true;
      ffmpeg.exitCode = 0;
      queueMicrotask(() => ffmpeg.emit('exit', 0, null));
      return true;
    });

    await expect(decoder.stop()).resolves.toBeUndefined();
    expect(ffmpeg.kill).toHaveBeenCalledWith('SIGTERM');
    expect(ffmpeg.stdout.listenerCount('readable')).toBe(0);
    expect(callbacks.onData).toHaveBeenCalledTimes(1);
    expect(callbacks.onEnd).not.toHaveBeenCalled();
  });

  it('bounds explicit stop when the child emits neither exit nor close', async () => {
    vi.useFakeTimers();
    const decoder = spawnDecoder(
      { path: '/data/tavern.mp3', loop: true },
      {
        onData: () => false,
        onPlaying() {},
        onEnd() {}
      }
    );
    const [ffmpeg] = fakes.children;

    const stopping = decoder.stop();
    await vi.advanceTimersByTimeAsync(DECODER_STOP_TIMEOUT_MILLISECONDS);

    await expect(stopping).resolves.toBeUndefined();
    expect(ffmpeg.kill).toHaveBeenCalledWith('SIGTERM');
    expect(ffmpeg.kill).toHaveBeenCalledWith('SIGKILL');
  });
});
