import { describe, expect, it, vi } from 'vitest';
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

function capturePushedFrames(mixer: PcmMixer): Buffer[] {
  const frames: Buffer[] = [];
  vi.spyOn(mixer, 'push').mockImplementation((chunk) => {
    if (Buffer.isBuffer(chunk)) frames.push(Buffer.from(chunk));
    return true;
  });
  return frames;
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
    get scheduled() {
      return scheduled !== null;
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
    const mixer = new PcmMixer(clock.scheduler, 0);
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
    const mixer = new PcmMixer(clock.scheduler, 0);
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

  it('primes a three-frame output lead before starting its real-time clock', () => {
    const clock = createScheduler();
    const mixer = new PcmMixer(clock.scheduler);
    mixer.setMasterVolume(1);
    mixer.addInput('ambience', 1);
    mixer.append(
      'ambience',
      Buffer.concat([constantFrame(1_000), constantFrame(2_000), constantFrame(3_000)])
    );
    const output = capturePushedFrames(mixer);

    mixer._read();

    expect(mixer.readableHighWaterMark).toBe(BYTES_PER_FRAME * 3);
    expect(output.map((frame) => frame.readInt16LE(0))).toEqual(
      [1_000, 2_000, 3_000].map((value) => Math.round(value * MIX_LINE_GAIN))
    );
    expect(clock.delay).toBe(FRAME_MILLISECONDS);
    mixer.destroy();
  });

  it('catches up bounded frames in order instead of deleting late PCM', () => {
    const clock = createScheduler();
    const mixer = new PcmMixer(clock.scheduler, 0);
    mixer.setMasterVolume(1);
    mixer.addInput('ambience', 1);
    mixer.append(
      'ambience',
      Buffer.concat([constantFrame(1_000), constantFrame(2_000), constantFrame(3_000)])
    );
    const output = capturePushedFrames(mixer);
    mixer._read();

    clock.fireAt(65);

    expect(output.map((frame) => frame.readInt16LE(0))).toEqual(
      [1_000, 2_000, 3_000].map((value) => Math.round(value * MIX_LINE_GAIN))
    );
    expect(mixer.diagnostics.staleFramesDropped).toBe(0);
    expect(clock.delay).toBe(15);
    mixer.destroy();
  });

  it('preserves the soundboard attack while catching up over ambience', () => {
    const clock = createScheduler();
    const mixer = new PcmMixer(clock.scheduler, 0);
    mixer.setMasterVolume(1);
    mixer.addInput('ambience', 1);
    mixer.addInput('soundboard', 1);
    mixer.append(
      'ambience',
      Buffer.concat([constantFrame(1_000), constantFrame(2_000), constantFrame(3_000)])
    );
    mixer.append(
      'soundboard',
      Buffer.concat([constantFrame(10_000), constantFrame(20_000), constantFrame(30_000)])
    );
    const output = capturePushedFrames(mixer);
    mixer._read();

    clock.fireAt(65);

    expect(output.map((frame) => frame.readInt16LE(0))).toEqual(
      [11_000, 22_000, 33_000].map((value) => Math.round(value * MIX_LINE_GAIN))
    );
    expect(mixer.diagnostics.staleFramesDropped).toBe(0);
    mixer.destroy();
  });

  it('mixes a newly started soundboard attack on the next cadence frame', () => {
    const clock = createScheduler();
    const mixer = new PcmMixer(clock.scheduler, 0);
    mixer.setMasterVolume(1);
    mixer.addInput('ambience', 1);
    mixer.append('ambience', Buffer.concat([constantFrame(1_000), constantFrame(2_000)]));
    const output = capturePushedFrames(mixer);
    mixer._read();
    clock.fireAt(20);

    mixer.addInput('soundboard', 1);
    mixer.append('soundboard', constantFrame(10_000));
    clock.fireAt(40);

    expect(output.map((frame) => frame.readInt16LE(0))).toEqual(
      [1_000, 12_000].map((value) => Math.round(value * MIX_LINE_GAIN))
    );
    mixer.destroy();
  });

  it('pauses one input without pausing the mix and accounts only consumed PCM bytes', () => {
    const clock = createScheduler();
    const mixer = new PcmMixer(clock.scheduler, 0);
    const consumed: Array<[number, number]> = [];
    mixer.setMasterVolume(1);
    mixer.addInput('ambience', 1, undefined, (bytes, total) => {
      consumed.push([bytes, total]);
    });
    mixer.addInput('soundboard', 1);
    mixer.append('ambience', Buffer.concat([constantFrame(1_000), constantFrame(2_000)]));
    mixer.append('soundboard', Buffer.concat([constantFrame(10_000), constantFrame(20_000)]));
    const output = capturePushedFrames(mixer);
    mixer.setInputPaused('ambience', true);
    mixer._read();

    clock.fireAt(FRAME_MILLISECONDS);
    expect(output.at(-1)?.readInt16LE(0)).toBe(Math.round(10_000 * MIX_LINE_GAIN));
    expect(mixer.bufferedBytes('ambience')).toBe(BYTES_PER_FRAME * 2);
    expect(mixer.consumedBytes('ambience')).toBe(0);
    expect(mixer.consumedFrames('ambience')).toBe(0);
    expect(consumed).toEqual([]);

    mixer.setInputPaused('ambience', false);
    clock.fireAt(FRAME_MILLISECONDS * 2);
    expect(output.at(-1)?.readInt16LE(0)).toBe(Math.round(21_000 * MIX_LINE_GAIN));
    expect(mixer.consumedBytes('ambience')).toBe(BYTES_PER_FRAME);
    expect(mixer.consumedFrames('ambience')).toBe(1);
    expect(consumed).toEqual([[BYTES_PER_FRAME, BYTES_PER_FRAME]]);
    mixer.destroy();
  });

  it('accounts the unpadded payload length of a final partial frame', () => {
    const clock = createScheduler();
    const mixer = new PcmMixer(clock.scheduler, 0);
    const consumed = vi.fn();
    mixer.addInput('effect', 1, undefined, consumed);
    mixer.append('effect', Buffer.alloc(1_234));
    mixer.endInput('effect');
    mixer._read();

    clock.fireAt(FRAME_MILLISECONDS);

    expect(mixer.consumedBytes('effect')).toBe(1_234);
    expect(mixer.consumedFrames('effect')).toBe(1);
    expect(consumed).toHaveBeenCalledWith(1_234, 1_234);
    mixer.destroy();
  });

  it('caps a long-stall catch-up at three frames and rebases the deadline', () => {
    const clock = createScheduler();
    const mixer = new PcmMixer(clock.scheduler, 0);
    mixer.setMasterVolume(1);
    mixer.addInput('ambience', 1);
    mixer.append(
      'ambience',
      Buffer.concat([1_000, 2_000, 3_000, 4_000, 5_000, 6_000].map((value) => constantFrame(value)))
    );
    const output = capturePushedFrames(mixer);
    mixer._read();

    clock.fireAt(220);

    expect(output.map((frame) => frame.readInt16LE(0))).toEqual(
      [1_000, 2_000, 3_000].map((value) => Math.round(value * MIX_LINE_GAIN))
    );
    expect(mixer.bufferedBytes('ambience')).toBe(BYTES_PER_FRAME * 3);
    expect(mixer.diagnostics.staleFramesDropped).toBe(0);
    expect(clock.delay).toBe(FRAME_MILLISECONDS);

    clock.fireAt(240);

    expect(output.at(-1)?.readInt16LE(0)).toBe(Math.round(4_000 * MIX_LINE_GAIN));
    expect(mixer.bufferedBytes('ambience')).toBe(BYTES_PER_FRAME * 2);
    mixer.destroy();
  });

  it('honors output backpressure without priming twice on resume', () => {
    const clock = createScheduler();
    const mixer = new PcmMixer(clock.scheduler);
    mixer.addInput('ambience', 1);
    mixer.append('ambience', Buffer.alloc(BYTES_PER_FRAME * 3));
    mixer._read();
    expect(mixer.readableLength).toBe(BYTES_PER_FRAME * 3);
    expect(clock.scheduled).toBe(false);
    mixer.read(BYTES_PER_FRAME * 3);
    expect(mixer.readableLength).toBe(0);
    mixer._read();
    expect(clock.scheduled).toBe(true);
    expect(clock.delay).toBe(FRAME_MILLISECONDS);

    mixer.append('ambience', Buffer.alloc(BYTES_PER_FRAME));
    clock.fireAt(FRAME_MILLISECONDS);
    expect(mixer.readableLength).toBe(BYTES_PER_FRAME);
    mixer.destroy();
  });
});
