import { describe, expect, it, vi } from 'vitest';
import { spawnPcmBufferDecoder } from './pcm-buffer-decoder';
import { BYTES_PER_FRAME } from './mixer';

describe('spawnPcmBufferDecoder', () => {
  it('delivers exact frames, honors backpressure, and preserves the final partial frame', async () => {
    const chunks: Buffer[] = [];
    const callbacks = {
      onData: vi.fn((chunk: Buffer) => {
        chunks.push(Buffer.from(chunk));
        return chunks.length !== 1;
      }),
      onPlaying: vi.fn(),
      onEnd: vi.fn()
    };
    const tail = Buffer.alloc(731, 9);
    const decoder = spawnPcmBufferDecoder(
      Buffer.concat([Buffer.alloc(BYTES_PER_FRAME, 3), Buffer.alloc(BYTES_PER_FRAME, 7), tail]),
      callbacks
    );

    await vi.waitFor(() => expect(callbacks.onData).toHaveBeenCalledTimes(1));
    expect(callbacks.onEnd).not.toHaveBeenCalled();

    decoder.resume();
    await vi.waitFor(() => expect(callbacks.onEnd).toHaveBeenCalledWith(null));

    expect(callbacks.onPlaying).toHaveBeenCalledTimes(1);
    expect(chunks.map((chunk) => chunk.length)).toEqual([
      BYTES_PER_FRAME,
      BYTES_PER_FRAME,
      tail.length
    ]);
    expect(chunks.at(-1)).toEqual(tail);
  });

  it('stops without announcing playback or EOF callbacks', async () => {
    const callbacks = {
      onData: vi.fn(() => true),
      onPlaying: vi.fn(),
      onEnd: vi.fn()
    };
    const decoder = spawnPcmBufferDecoder(Buffer.alloc(BYTES_PER_FRAME), callbacks);

    await decoder.stop();
    await Promise.resolve();

    expect(callbacks.onData).not.toHaveBeenCalled();
    expect(callbacks.onPlaying).not.toHaveBeenCalled();
    expect(callbacks.onEnd).not.toHaveBeenCalled();
  });
});
