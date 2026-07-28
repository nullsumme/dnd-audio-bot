import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeChild extends EventEmitter {
  stdout: PassThrough;
  stderr: PassThrough;
  exitCode: number | null;
  kill: ReturnType<typeof vi.fn>;
}

const fakes = vi.hoisted(() => ({
  children: [] as FakeChild[],
  args: [] as string[][]
}));

vi.mock('node:child_process', () => ({
  spawn: vi.fn((_command: string, args: string[]) => {
    const child = new EventEmitter() as FakeChild;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.exitCode = null;
    child.kill = vi.fn(() => true);
    fakes.children.push(child);
    fakes.args.push(args);
    return child;
  })
}));

import { decodePcmFile } from './pcm-cache';

describe('decodePcmFile process bounds', () => {
  beforeEach(() => {
    fakes.children.length = 0;
    fakes.args.length = 0;
  });

  it('copies PCM into one reserved allocation and resolves only after a clean close', async () => {
    const decoding = decodePcmFile('/data/toy.mp3', 16, 'ffmpeg-test');
    const [child] = fakes.children;
    child.stdout.write(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));
    child.exitCode = 0;
    child.emit('close', 0);

    await expect(decoding).resolves.toMatchObject({ allocationBytes: 16 });
    const decoded = await decoding;
    expect(decoded.pcm).toEqual(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));
    expect(fakes.args[0]).toContain('/data/toy.mp3');
  });

  it('terminates output that crosses the reserved allocation', async () => {
    const decoding = decodePcmFile('/data/oversized.mp3', 4, 'ffmpeg-test');
    const [child] = fakes.children;
    child.stdout.write(Buffer.alloc(8));
    child.exitCode = 1;
    child.emit('close', 1);

    await expect(decoding).rejects.toThrow('reserved cache allocation');
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('terminates and rejects an active decode when aborted', async () => {
    const controller = new AbortController();
    const decoding = decodePcmFile('/data/toy.mp3', 16, 'ffmpeg-test', controller.signal);
    const [child] = fakes.children;

    controller.abort();
    child.exitCode = 1;
    child.emit('close', 1);

    await expect(decoding).rejects.toThrow('cancelled');
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });
});
