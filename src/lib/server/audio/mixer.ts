import { Readable } from 'node:stream';

export const SAMPLE_RATE = 48_000;
export const CHANNELS = 2;
export const FRAME_MILLISECONDS = 20;
export const SAMPLES_PER_FRAME = (SAMPLE_RATE * FRAME_MILLISECONDS * CHANNELS) / 1_000;
export const BYTES_PER_FRAME = SAMPLES_PER_FRAME * 2;
export const INPUT_HIGH_WATERMARK_BYTES = BYTES_PER_FRAME * 25;
export const INPUT_LOW_WATERMARK_BYTES = BYTES_PER_FRAME * 10;
export const MAX_CATCH_UP_FRAMES = 10;

export interface MixerScheduler {
  now(): number;
  setTimeout(callback: () => void, delay: number): object;
  clearTimeout(timer: object): void;
}

const realtimeScheduler: MixerScheduler = {
  now: () => performance.now(),
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: (timer) => clearTimeout(timer as NodeJS.Timeout)
};

interface MixerInput {
  buffer: Buffer;
  volume: number;
  backpressured: boolean;
  onDrain: () => void;
}

export function mixPcmFrames(frames: Array<{ frame: Buffer; volume: number }>, master = 1): Buffer {
  const output = Buffer.alloc(BYTES_PER_FRAME);
  if (frames.length === 0 || master <= 0) return output;

  for (let offset = 0; offset < BYTES_PER_FRAME; offset += 2) {
    let sample = 0;
    for (const input of frames) {
      sample += input.frame.readInt16LE(offset) * input.volume;
    }
    const mixed = Math.max(-32_768, Math.min(32_767, Math.round(sample * master)));
    output.writeInt16LE(mixed, offset);
  }
  return output;
}

export class PcmMixer extends Readable {
  #inputs = new Map<string, MixerInput>();
  #masterVolume = 0.8;
  #scheduler: MixerScheduler;
  #timer: object | null = null;
  #nextFrameAt: number | null = null;

  constructor(scheduler: MixerScheduler = realtimeScheduler) {
    super({ highWaterMark: BYTES_PER_FRAME * 10 });
    this.#scheduler = scheduler;
  }

  get masterVolume(): number {
    return this.#masterVolume;
  }

  setMasterVolume(volume: number): void {
    this.#masterVolume = Math.max(0, Math.min(1, volume));
  }

  addInput(id: string, volume: number, onDrain: () => void = () => {}): void {
    this.#inputs.set(id, {
      buffer: Buffer.alloc(0),
      volume: Math.max(0, Math.min(1, volume)),
      backpressured: false,
      onDrain
    });
  }

  removeInput(id: string): void {
    this.#inputs.delete(id);
  }

  setInputVolume(id: string, volume: number): void {
    const input = this.#inputs.get(id);
    if (input) input.volume = Math.max(0, Math.min(1, volume));
  }

  append(id: string, chunk: Buffer): boolean {
    const input = this.#inputs.get(id);
    if (!input || chunk.length === 0) return false;
    input.buffer = Buffer.concat([input.buffer, chunk]);
    if (input.buffer.length >= INPUT_HIGH_WATERMARK_BYTES) {
      input.backpressured = true;
      return false;
    }
    return true;
  }

  bufferedBytes(id: string): number {
    return this.#inputs.get(id)?.buffer.length ?? 0;
  }

  override _read(): void {
    if (this.#timer) return;
    if (this.#nextFrameAt === null) this.#nextFrameAt = this.#scheduler.now() + FRAME_MILLISECONDS;
    this.#scheduleFrame();
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    if (this.#timer) this.#scheduler.clearTimeout(this.#timer);
    this.#timer = null;
    this.#nextFrameAt = null;
    this.#inputs.clear();
    callback(error);
  }

  #scheduleFrame(): void {
    if (this.#timer || this.#nextFrameAt === null) return;
    const delay = Math.max(0, this.#nextFrameAt - this.#scheduler.now());
    this.#timer = this.#scheduler.setTimeout(() => this.#onTimer(), delay);
  }

  #onTimer(): void {
    const now = this.#scheduler.now();
    let emitted = 0;
    let flowing = true;

    while (
      flowing &&
      this.#nextFrameAt !== null &&
      this.#nextFrameAt <= now &&
      emitted < MAX_CATCH_UP_FRAMES
    ) {
      flowing = this.#emitFrame();
      this.#nextFrameAt += FRAME_MILLISECONDS;
      emitted += 1;
    }

    this.#timer = null;
    if (!flowing) {
      this.#nextFrameAt = null;
      return;
    }
    this.#scheduleFrame();
  }

  #emitFrame(): boolean {
    const frames: Array<{ frame: Buffer; volume: number }> = [];
    for (const input of this.#inputs.values()) {
      const frame = Buffer.alloc(BYTES_PER_FRAME);
      const available = Math.min(BYTES_PER_FRAME, input.buffer.length);
      if (available > 0) {
        input.buffer.copy(frame, 0, 0, available);
        input.buffer = input.buffer.subarray(available);
      }
      frames.push({ frame, volume: input.volume });
      if (input.backpressured && input.buffer.length <= INPUT_LOW_WATERMARK_BYTES) {
        input.backpressured = false;
        input.onDrain();
      }
    }

    return this.push(mixPcmFrames(frames, this.#masterVolume));
  }
}
