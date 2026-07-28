import { describe, expect, it } from 'vitest';
import {
  BYTES_PER_FRAME,
  FRAME_MILLISECONDS,
  MIX_LINE_GAIN,
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

function createScheduler() {
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
  return {
    scheduler,
    get delay() {
      return delay;
    },
    fireAt(milliseconds: number) {
      now = milliseconds;
      const callback = scheduled as (() => void) | null;
      scheduled = null;
      expect(callback).not.toBeNull();
      callback?.();
    }
  };
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
    expect(mixed.readInt16LE(0)).toBe(Math.round(9_000 * 0.5 * MIX_LINE_GAIN));
    expect(mixed.readInt16LE(mixed.length - 2)).toBe(Math.round(9_000 * 0.5 * MIX_LINE_GAIN));
  });

  it('adds clean bus headroom instead of hard-clipping overlapping sources', () => {
    const positive = mixPcmFrames(
      [
        { frame: constantFrame(32_767), volume: 1 },
        { frame: constantFrame(32_767), volume: 1 }
      ],
      1
    );
    const negative = mixPcmFrames(
      [
        { frame: constantFrame(-32_768), volume: 1 },
        { frame: constantFrame(-32_768), volume: 1 }
      ],
      1
    );
    expect(positive.readInt16LE(0)).toBe(Math.round(32_767 * MIX_BUS_HEADROOM));
    expect(negative.readInt16LE(0)).toBe(Math.round(-32_768 * MIX_BUS_HEADROOM));
    expect(positive.readInt16LE(0)).toBeLessThan(32_767);
    expect(negative.readInt16LE(0)).toBeGreaterThan(-32_768);
  });

  it('keeps background gain stable at sound-effect onset and EOF', () => {
    const background = { frame: constantFrame(12_000), volume: 0.65 };
    const silentEffect = { frame: constantFrame(0), volume: 0.85 };
    const before = mixPcmFrames([background], 0.9);
    const onset = mixPcmFrames([background, silentEffect], 0.9);
    const after = mixPcmFrames([background], 0.9);

    expect(onset).toEqual(before);
    expect(after).toEqual(before);
  });

  it('emits silence without inputs', () => {
    expect(mixPcmFrames([]).equals(Buffer.alloc(BYTES_PER_FRAME))).toBe(true);
  });
});

describe('PcmMixer timing', () => {
  it('defers fragmented PCM until one complete frame is prebuffered', () => {
    const clock = createScheduler();
    const mixer = new PcmMixer(clock.scheduler);
    const frame = constantFrame(1_000);
    mixer.setMasterVolume(1);
    mixer.addInput('toy', 1);
    expect(mixer.append('toy', frame.subarray(0, BYTES_PER_FRAME - 2))).toBe(true);
    mixer._read();

    clock.fireAt(FRAME_MILLISECONDS);
    const silence = mixer.read(BYTES_PER_FRAME) as Buffer;
    expect(silence.equals(Buffer.alloc(BYTES_PER_FRAME))).toBe(true);
    expect(mixer.bufferedBytes('toy')).toBe(BYTES_PER_FRAME - 2);
    expect(mixer.diagnostics.partialFramesDeferred).toBe(1);

    expect(mixer.append('toy', frame.subarray(BYTES_PER_FRAME - 2))).toBe(true);
    clock.fireAt(FRAME_MILLISECONDS * 2);
    const output = mixer.read(BYTES_PER_FRAME) as Buffer;
    expect(output.readInt16LE(0)).toBe(Math.round(1_000 * MIX_LINE_GAIN));
    expect(output.readInt16LE(output.length - 2)).toBe(Math.round(1_000 * MIX_LINE_GAIN));
    expect(mixer.bufferedBytes('toy')).toBe(0);
    mixer.destroy();
  });

  it('pads one fragmented Toy-sized final frame exactly once and drains the full tail', () => {
    const clock = createScheduler();
    const mixer = new PcmMixer(clock.scheduler);
    const toyBytes = Math.round(1.392 * 48_000 * 2 * 2);
    const toy = Buffer.alloc(toyBytes);
    for (let offset = 0; offset < toy.length; offset += 2) toy.writeInt16LE(1_000, offset);
    const fragmentSizes = [254, 4_098, 7_682, 1_114, 19_202];
    let offset = 0;
    let fragment = 0;
    let finished = 0;
    mixer.setMasterVolume(1);
    mixer.addInput('toy-live', 1);
    // Fragment boundaries deliberately do not align with stereo samples or
    // Discord frames.
    offset = 0;
    fragment = 0;
    while (offset < toy.length) {
      const size = Math.min(fragmentSizes[fragment % fragmentSizes.length], toy.length - offset);
      mixer.append('toy-live', toy.subarray(offset, offset + size));
      offset += size;
      fragment += 1;
    }
    mixer.endInput('toy-live', () => {
      finished += 1;
    });
    mixer._read();

    const outputFrames: Buffer[] = [];
    const expectedFrames = Math.ceil(toy.length / BYTES_PER_FRAME);
    for (let index = 0; index < expectedFrames; index += 1) {
      clock.fireAt((index + 1) * FRAME_MILLISECONDS);
      outputFrames.push(mixer.read(BYTES_PER_FRAME) as Buffer);
    }

    expect(finished).toBe(1);
    expect(mixer.diagnostics.finalPartialFramesPadded).toBe(1);
    expect(mixer.bufferedBytes('toy-live')).toBe(0);
    const finalFrame = outputFrames.at(-1)!;
    const finalPayloadBytes = toy.length % BYTES_PER_FRAME;
    expect(finalFrame.readInt16LE(finalPayloadBytes - 2)).toBe(Math.round(1_000 * MIX_LINE_GAIN));
    expect(
      finalFrame
        .subarray(finalPayloadBytes)
        .equals(Buffer.alloc(BYTES_PER_FRAME - finalPayloadBytes))
    ).toBe(true);
    clock.fireAt((expectedFrames + 1) * FRAME_MILLISECONDS);
    mixer.read(BYTES_PER_FRAME);
    expect(finished).toBe(1);
    expect(mixer.diagnostics.finalPartialFramesPadded).toBe(1);
    mixer.destroy();
  });

  it('drops stale PCM and resets its deadline instead of burst catch-up after an event-loop stall', () => {
    const clock = createScheduler();
    const mixer = new PcmMixer(clock.scheduler);
    mixer.setMasterVolume(1);
    mixer.addInput('ambience', 1);
    mixer.append(
      'ambience',
      Buffer.concat([constantFrame(1_000), constantFrame(2_000), constantFrame(3_000)])
    );
    mixer._read();

    clock.fireAt(65);

    expect(mixer.readableLength).toBe(BYTES_PER_FRAME);
    const output = mixer.read(BYTES_PER_FRAME) as Buffer;
    expect(output.readInt16LE(0)).toBe(Math.round(3_000 * MIX_LINE_GAIN));
    expect(mixer.diagnostics.staleFramesDropped).toBe(2);
    expect(clock.delay).toBe(FRAME_MILLISECONDS);
    mixer.destroy();
  });
});
