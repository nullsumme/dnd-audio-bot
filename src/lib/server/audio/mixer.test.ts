import { describe, expect, it } from 'vitest';
import { BYTES_PER_FRAME, mixPcmFrames } from './mixer';

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

  it('clips positive and negative samples safely', () => {
    const positive = mixPcmFrames([
      { frame: constantFrame(30_000), volume: 1 },
      { frame: constantFrame(30_000), volume: 1 }
    ]);
    const negative = mixPcmFrames([
      { frame: constantFrame(-30_000), volume: 1 },
      { frame: constantFrame(-30_000), volume: 1 }
    ]);
    expect(positive.readInt16LE(0)).toBe(32_767);
    expect(negative.readInt16LE(0)).toBe(-32_768);
  });

  it('emits silence without inputs', () => {
    expect(mixPcmFrames([]).equals(Buffer.alloc(BYTES_PER_FRAME))).toBe(true);
  });
});
