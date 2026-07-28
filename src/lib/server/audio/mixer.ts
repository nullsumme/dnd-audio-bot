import { Readable } from 'node:stream';

export const SAMPLE_RATE = 48_000;
export const CHANNELS = 2;
export const FRAME_MILLISECONDS = 20;
export const SAMPLES_PER_FRAME = (SAMPLE_RATE * FRAME_MILLISECONDS * CHANNELS) / 1_000;
export const BYTES_PER_FRAME = SAMPLES_PER_FRAME * 2;
export const INPUT_HIGH_WATERMARK_BYTES = BYTES_PER_FRAME * 3;
export const INPUT_LOW_WATERMARK_BYTES = BYTES_PER_FRAME;
export const MIX_BUS_HEADROOM = 0.98;
export const MAX_MIX_LINES = 2;
export const MIX_LINE_GAIN = MIX_BUS_HEADROOM / MAX_MIX_LINES;

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
  ended: boolean;
  partialDeferred: boolean;
  onDrain: () => void;
  onFinished: (() => void) | null;
}

export interface MixerDiagnostics {
  partialFramesDeferred: number;
  finalPartialFramesPadded: number;
  staleFramesDropped: number;
}

export function mixPcmFrames(frames: Array<{ frame: Buffer; volume: number }>, master = 1): Buffer {
  const output = Buffer.alloc(BYTES_PER_FRAME);
  if (frames.length === 0 || master <= 0) return output;

  const safeMaster = Math.max(0, Math.min(1, master));
  const volumes = frames.map((input) => Math.max(0, Math.min(1, input.volume)));
  // Soundkeep has exactly two mix lines. Reserving a fixed half-bus for each line
  // prevents clipping without changing the background gain when a sound effect
  // starts or ends. The fixed gain is zero-lookahead and therefore adds no delay.
  const mixGain = safeMaster * MIX_LINE_GAIN;

  for (let offset = 0; offset < BYTES_PER_FRAME; offset += 2) {
    let sample = 0;
    for (let index = 0; index < frames.length; index += 1) {
      sample += frames[index].frame.readInt16LE(offset) * volumes[index];
    }
    const mixed = Math.max(-32_768, Math.min(32_767, Math.round(sample * mixGain)));
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
  #diagnostics: MixerDiagnostics = {
    partialFramesDeferred: 0,
    finalPartialFramesPadded: 0,
    staleFramesDropped: 0
  };

  constructor(scheduler: MixerScheduler = realtimeScheduler) {
    super({ highWaterMark: BYTES_PER_FRAME * 10 });
    this.#scheduler = scheduler;
  }

  get masterVolume(): number {
    return this.#masterVolume;
  }

  get diagnostics(): MixerDiagnostics {
    return { ...this.#diagnostics };
  }

  setMasterVolume(volume: number): void {
    this.#masterVolume = Math.max(0, Math.min(1, volume));
  }

  addInput(id: string, volume: number, onDrain: () => void = () => {}): void {
    this.#inputs.set(id, {
      buffer: Buffer.alloc(0),
      volume: Math.max(0, Math.min(1, volume)),
      backpressured: false,
      ended: false,
      partialDeferred: false,
      onDrain,
      onFinished: null
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
    if (!input || input.ended || chunk.length === 0) return false;
    input.buffer = Buffer.concat([input.buffer, chunk]);
    if (input.buffer.length >= BYTES_PER_FRAME) input.partialDeferred = false;
    if (input.buffer.length >= INPUT_HIGH_WATERMARK_BYTES) {
      input.backpressured = true;
      return false;
    }
    return true;
  }

  endInput(id: string, onFinished: () => void = () => {}): boolean {
    const input = this.#inputs.get(id);
    if (!input || input.ended) return false;
    input.ended = true;
    input.onFinished = onFinished;
    if (input.buffer.length === 0) this.#finishInput(input);
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
    const deadline = this.#nextFrameAt;
    if (deadline === null) return;
    const missedFrames = Math.floor(Math.max(0, now - deadline) / FRAME_MILLISECONDS);
    if (missedFrames > 0) this.#dropStaleFrames(missedFrames);
    const flowing = this.#emitFrame();

    this.#timer = null;
    if (!flowing) {
      this.#nextFrameAt = null;
      return;
    }
    this.#nextFrameAt = missedFrames > 0 ? now + FRAME_MILLISECONDS : deadline + FRAME_MILLISECONDS;
    this.#scheduleFrame();
  }

  #emitFrame(): boolean {
    const frames: Array<{ frame: Buffer; volume: number }> = [];
    const finished: Array<() => void> = [];
    for (const input of this.#inputs.values()) {
      if (input.buffer.length >= BYTES_PER_FRAME) {
        const frame = input.buffer.subarray(0, BYTES_PER_FRAME);
        input.buffer = input.buffer.subarray(BYTES_PER_FRAME);
        input.partialDeferred = false;
        frames.push({ frame, volume: input.volume });
      } else if (input.ended && input.buffer.length > 0) {
        const frame = Buffer.alloc(BYTES_PER_FRAME);
        input.buffer.copy(frame);
        input.buffer = Buffer.alloc(0);
        input.partialDeferred = false;
        this.#diagnostics.finalPartialFramesPadded += 1;
        frames.push({ frame, volume: input.volume });
      } else if (input.buffer.length > 0 && !input.partialDeferred) {
        input.partialDeferred = true;
        this.#diagnostics.partialFramesDeferred += 1;
      }

      this.#releaseBackpressure(input);
      if (input.ended && input.buffer.length === 0 && input.onFinished) {
        const callback = input.onFinished;
        input.onFinished = null;
        finished.push(callback);
      }
    }

    const flowing = this.push(mixPcmFrames(frames, this.#masterVolume));
    finished.forEach((callback) => callback());
    return flowing;
  }

  #dropStaleFrames(missedFrames: number): void {
    for (const input of this.#inputs.values()) {
      const availableFrames = input.ended
        ? Math.ceil(input.buffer.length / BYTES_PER_FRAME)
        : Math.floor(input.buffer.length / BYTES_PER_FRAME);
      const droppedFrames = Math.min(missedFrames, Math.max(0, availableFrames - 1));
      if (droppedFrames === 0) continue;
      input.buffer = input.buffer.subarray(droppedFrames * BYTES_PER_FRAME);
      input.partialDeferred = false;
      this.#diagnostics.staleFramesDropped += droppedFrames;
      this.#releaseBackpressure(input);
    }
  }

  #releaseBackpressure(input: MixerInput): void {
    if (!input.backpressured || input.buffer.length > INPUT_LOW_WATERMARK_BYTES) return;
    input.backpressured = false;
    input.onDrain();
  }

  #finishInput(input: MixerInput): void {
    const callback = input.onFinished;
    input.onFinished = null;
    callback?.();
  }
}
