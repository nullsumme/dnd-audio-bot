import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeChild extends EventEmitter {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
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
      child.exitCode = null;
      child.kill = vi.fn(() => true);
      fakes.children.push(child);
      return child;
    })
  };
});

import {
  DISCORD_OPUS_PAGE_MILLISECONDS,
  buildDiscordOpusArgs,
  spawnDiscordOpusEncoder
} from './encoder';

describe('Discord Opus encoder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakes.children.length = 0;
  });

  it('emits and flushes one low-delay Opus packet per Discord frame', () => {
    expect(DISCORD_OPUS_PAGE_MILLISECONDS).toBe(20);
    for (const bitrate of [64_000, 96_000, 128_000, 384_000]) {
      expect(buildDiscordOpusArgs(bitrate)).toEqual(
        expect.arrayContaining([
          '-b:a',
          `${bitrate}`,
          '-vbr',
          'constrained',
          '-application',
          'lowdelay',
          '-frame_duration',
          '20',
          '-page_duration',
          '20000',
          '-flush_packets',
          '1'
        ])
      );
    }
    expect(() => buildDiscordOpusArgs(7_999)).toThrow(RangeError);
    expect(() => buildDiscordOpusArgs(384_001)).toThrow(RangeError);
  });

  it('reports clean and failed unexpected exits', () => {
    const input = new PassThrough();
    const lifecycle = { onError: vi.fn(), onClose: vi.fn() };
    spawnDiscordOpusEncoder(input, 96_000, lifecycle);
    const clean = fakes.children[0];

    clean.emit('close', 0, null);
    expect(lifecycle.onClose).toHaveBeenLastCalledWith({
      code: 0,
      signal: null,
      expected: false,
      message: null
    });

    spawnDiscordOpusEncoder(input, 128_000, lifecycle);
    const failed = fakes.children[1];
    failed.stderr.emit('data', Buffer.from('encoder failed'));
    failed.emit('close', 1, null);
    expect(lifecycle.onClose).toHaveBeenLastCalledWith({
      code: 1,
      signal: null,
      expected: false,
      message: 'encoder failed'
    });
  });

  it('distinguishes child errors and waits for intentional shutdown to close', async () => {
    const input = new PassThrough();
    const lifecycle = { onError: vi.fn(), onClose: vi.fn() };
    const pipeline = spawnDiscordOpusEncoder(input, 64_000, lifecycle);
    const child = fakes.children[0];

    child.emit('error', new Error('spawn failed'));
    expect(lifecycle.onError).toHaveBeenCalledWith('Discord Opus encoder: spawn failed');

    let stopped = false;
    const stopping = pipeline.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    child.emit('close', null, 'SIGTERM');
    await stopping;
    expect(stopped).toBe(true);
    expect(lifecycle.onClose).toHaveBeenCalledWith({
      code: null,
      signal: 'SIGTERM',
      expected: true,
      message: 'Discord Opus encoder exited with code unknown.'
    });
  });

  it('isolates warm-up input from pipe backpressure and reports a blocked candidate', () => {
    const input = new PassThrough();
    const activeSink = new PassThrough();
    const activeFrames: string[] = [];
    activeSink.on('data', (chunk: Buffer) => activeFrames.push(chunk.toString('utf8')));
    input.pipe(activeSink);
    const pipeSpy = vi.spyOn(input, 'pipe');
    const lifecycle = { onError: vi.fn(), onClose: vi.fn() };

    spawnDiscordOpusEncoder(input, 96_000, lifecycle, { isolatedInput: true });
    const child = fakes.children[0];
    const candidateWrite = vi.spyOn(child.stdin, 'write').mockReturnValue(false);

    expect(pipeSpy).not.toHaveBeenCalled();
    input.write(Buffer.from('first'));
    input.write(Buffer.from('second'));

    expect(activeFrames).toEqual(['first', 'second']);
    expect(candidateWrite).toHaveBeenCalledTimes(1);
    expect(lifecycle.onError).toHaveBeenCalledOnce();
    expect(lifecycle.onError).toHaveBeenCalledWith(
      'Discord Opus encoder warm-up input backpressured before it became playable.'
    );
    expect(pipeSpy).not.toHaveBeenCalled();

    child.emit('close', 1, null);
    input.unpipe(activeSink);
  });

  it('detaches isolated warm-up input on stop and unexpected close', async () => {
    const stoppedInput = new PassThrough();
    const stoppedLifecycle = { onError: vi.fn(), onClose: vi.fn() };
    const stoppedPipeline = spawnDiscordOpusEncoder(stoppedInput, 64_000, stoppedLifecycle, {
      isolatedInput: true
    });
    const stoppedChild = fakes.children[0];
    const stoppedWrite = vi.spyOn(stoppedChild.stdin, 'write');
    const stoppedListener = stoppedInput.listeners('data')[0];

    expect(stoppedListener).toBeTypeOf('function');
    const stopping = stoppedPipeline.stop();
    expect(stoppedInput.listeners('data')).not.toContain(stoppedListener);
    stoppedInput.write(Buffer.from('after stop'));
    expect(stoppedWrite).not.toHaveBeenCalled();
    stoppedChild.emit('close', null, 'SIGTERM');
    await stopping;

    const closedInput = new PassThrough();
    const closedLifecycle = { onError: vi.fn(), onClose: vi.fn() };
    spawnDiscordOpusEncoder(closedInput, 128_000, closedLifecycle, { isolatedInput: true });
    const closedChild = fakes.children[1];
    const closedWrite = vi.spyOn(closedChild.stdin, 'write');
    const closedListener = closedInput.listeners('data')[0];

    expect(closedListener).toBeTypeOf('function');
    closedChild.emit('close', 1, null);
    expect(closedInput.listeners('data')).not.toContain(closedListener);
    closedInput.write(Buffer.from('after close'));
    expect(closedWrite).not.toHaveBeenCalled();
  });

  it('promotes isolated warm-up input to the normal piped path', async () => {
    const input = new PassThrough();
    const pipeSpy = vi.spyOn(input, 'pipe');
    const unpipeSpy = vi.spyOn(input, 'unpipe');
    const lifecycle = { onError: vi.fn(), onClose: vi.fn() };
    const pipeline = spawnDiscordOpusEncoder(input, 96_000, lifecycle, { isolatedInput: true });
    const child = fakes.children[0];
    const isolatedListener = input.listeners('data')[0];

    expect(isolatedListener).toBeTypeOf('function');
    expect(pipeSpy).not.toHaveBeenCalled();
    pipeline.promoteInput?.();

    expect(input.listeners('data')).not.toContain(isolatedListener);
    expect(pipeSpy).toHaveBeenCalledOnce();
    expect(pipeSpy).toHaveBeenCalledWith(child.stdin);

    const pipedWrite = vi.spyOn(child.stdin, 'write');
    input.write(Buffer.from('promoted'));
    expect(pipedWrite).toHaveBeenCalledWith(Buffer.from('promoted'));

    const stopping = pipeline.stop();
    expect(unpipeSpy).toHaveBeenCalledWith(child.stdin);
    child.emit('close', null, 'SIGTERM');
    await stopping;
  });
});
