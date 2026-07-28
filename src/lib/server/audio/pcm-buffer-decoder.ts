import type { DecoderCallbacks, DecoderHandle } from './decoder';
import { BYTES_PER_FRAME } from './mixer';

export function spawnPcmBufferDecoder(pcm: Buffer, callbacks: DecoderCallbacks): DecoderHandle {
  let offset = 0;
  let backpressured = false;
  let stopped = false;
  let ended = false;
  let announcedPlaying = false;
  let resolveClosed: () => void = () => {};
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });

  const finish = () => {
    if (ended) return;
    ended = true;
    if (!stopped) callbacks.onEnd(null);
    resolveClosed();
  };

  const pump = () => {
    if (stopped || ended || backpressured) return;
    while (offset < pcm.length) {
      const end = Math.min(offset + BYTES_PER_FRAME, pcm.length);
      const chunk = pcm.subarray(offset, end);
      offset = end;
      if (!announcedPlaying) {
        announcedPlaying = true;
        callbacks.onPlaying();
      }
      if (!callbacks.onData(chunk)) {
        backpressured = true;
        return;
      }
    }
    queueMicrotask(finish);
  };

  // Keep callbacks asynchronous so callers can publish the returned handle before EOF.
  queueMicrotask(pump);

  return {
    resume() {
      if (!backpressured || stopped || ended) return;
      backpressured = false;
      pump();
    },
    async stop() {
      if (!stopped && !ended) {
        stopped = true;
        finish();
      }
      await closed;
    }
  };
}
