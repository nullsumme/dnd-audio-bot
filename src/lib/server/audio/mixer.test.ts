import { describe, expect, it } from 'vitest';
import {
  BYTES_PER_FRAME,
  FRAME_MILLISECONDS,
  MIX_BUS_HEADROOM,
  PcmMixer,
  mixPcmFrames,
  type MixerScheduler
} from './mixer';

function constantFrame(value: number): Buffer {
  const frame = Buffer.alloc(BYTES_PER_FRAME);
  for (let offset = 0; offset < frame.length; offset += 2) frame.writeInt16LE(value, offset);
  return frame;
}

describe('mixPcmFrames', () => {
  it('mixes sources with independent and master gain', () => {
    const mixed = mixPcmFrames(
      [
        { frame: constantFrame(10_000), volume: 0.5 },
        { frame: constantFrame(4_000), volume: 1 }
      ],
      0.5
    );
    expect(mixed.readInt16LE(0)).toBe(4_500);
    expect(mixed.readInt16LE(mixed.length - 2)).toBe(4_500);
  });

  it('adds clean bus headroom instead of hard-clipping overlapping sources', () => {
    const positive = mixPcmFrames(
      [
        { frame: constantFrame(32_767), volume: 0.65 },
        { frame: constantFrame(32_767), volume: 0.85 }
      ],
      0.8
    );
    const negative = mixPcmFrames(
      [
        { frame: constantFrame(-32_768), volume: 0.65 },
        { frame: constantFrame(-32_768), volume: 0.85 }
      ],
      0.8
    );
    expect(positive.readInt16LE(0)).toBe(Math.round(32_767 * MIX_BUS_HEADROOM));
    expect(negative.readInt16LE(0)).toBe(Math.round(-32_768 * MIX_BUS_HEADROOM));
    expect(positive.readInt16LE(0)).toBeLessThan(32_767);
    expect(negative.readInt16LE(0)).toBeGreaterThan(-32_768);
  });

  it('emits silence without inputs', () => {
    expect(mixPcmFrames([]).equals(Buffer.alloc(BYTES_PER_FRAME))).toBe(true);
  });
});

describe('PcmMixer timing', () => {
  it('catches up frames after a delayed timer without accumulating clock drift', () => {
    let now = 0;
    let scheduled: (() => void) | null = null;
    let delay = -1;
    const timer = {};
    const scheduler: MixerScheduler = {
      now: () => now,
      setTimeout: (callback, milliseconds) => {
        scheduled = callback;
        delay = milliseconds;
        return timer;
      },
      clearTimeout: () => {
        scheduled = null;
      }
    };
    const mixer = new PcmMixer(scheduler);
    mixer._read();

    expect(delay).toBe(FRAME_MILLISECONDS);
    now = 65;
    const fire = scheduled as (() => void) | null;
    expect(fire).not.toBeNull();
    fire?.();

    expect(mixer.readableLength).toBe(BYTES_PER_FRAME * 3);
    expect(delay).toBe(15);
    mixer.destroy();
  });
});
