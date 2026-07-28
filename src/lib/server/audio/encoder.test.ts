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
  DISCORD_OPUS_ARGS,
  DISCORD_OPUS_BITRATE,
  DISCORD_OPUS_PAGE_MILLISECONDS,
  spawnDiscordOpusEncoder
} from './encoder';

describe('Discord Opus encoder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakes.children.length = 0;
  });

  it('emits and flushes one low-delay Opus packet per Discord frame', () => {
    expect(DISCORD_OPUS_BITRATE).toBe(64_000);
    expect(DISCORD_OPUS_PAGE_MILLISECONDS).toBe(20);
    expect(DISCORD_OPUS_ARGS).toEqual(
      expect.arrayContaining([
        '-b:a',
        '64000',
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
  });

  it('reports clean and failed unexpected exits', () => {
    const input = new PassThrough();
    const lifecycle = { onError: vi.fn(), onClose: vi.fn() };
    spawnDiscordOpusEncoder(input, lifecycle);
    const clean = fakes.children[0];

    clean.emit('close', 0, null);
    expect(lifecycle.onClose).toHaveBeenLastCalledWith({
      code: 0,
      signal: null,
      expected: false,
      message: null
    });

    spawnDiscordOpusEncoder(input, lifecycle);
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
    const pipeline = spawnDiscordOpusEncoder(input, lifecycle);
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
});
