import { Readable } from 'node:stream';

export const SAMPLE_RATE = 48_000;
export const CHANNELS = 2;
export const FRAME_MILLISECONDS = 20;
export const SAMPLES_PER_FRAME = (SAMPLE_RATE * FRAME_MILLISECONDS * CHANNELS) / 1_000;
export const BYTES_PER_FRAME = SAMPLES_PER_FRAME * 2;
const MAX_BUFFER_BYTES = BYTES_PER_FRAME * 100;

interface MixerInput {
  buffer: Buffer;
  volume: number;
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
  #timer: NodeJS.Timeout | null = null;

  constructor() {
    super({ highWaterMark: BYTES_PER_FRAME * 10 });
  }

  get masterVolume(): number {
    return this.#masterVolume;
  }

  setMasterVolume(volume: number): void {
    this.#masterVolume = Math.max(0, Math.min(1, volume));
  }

  addInput(id: string, volume: number): void {
    this.#inputs.set(id, {
      buffer: Buffer.alloc(0),
      volume: Math.max(0, Math.min(1, volume))
    });
  }

  removeInput(id: string): void {
    this.#inputs.delete(id);
  }

  setInputVolume(id: string, volume: number): void {
    const input = this.#inputs.get(id);
    if (input) input.volume = Math.max(0, Math.min(1, volume));
  }

  append(id: string, chunk: Buffer): void {
    const input = this.#inputs.get(id);
    if (!input || chunk.length === 0) return;
    input.buffer = Buffer.concat([input.buffer, chunk]);
    if (input.buffer.length > MAX_BUFFER_BYTES) {
      input.buffer = input.buffer.subarray(input.buffer.length - MAX_BUFFER_BYTES);
    }
  }

  override _read(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => this.#emitFrame(), FRAME_MILLISECONDS);
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    this.#inputs.clear();
    callback(error);
  }

  #emitFrame(): void {
    const frames: Array<{ frame: Buffer; volume: number }> = [];
    for (const input of this.#inputs.values()) {
      const frame = Buffer.alloc(BYTES_PER_FRAME);
      const available = Math.min(BYTES_PER_FRAME, input.buffer.length);
      if (available > 0) {
        input.buffer.copy(frame, 0, 0, available);
        input.buffer = input.buffer.subarray(available);
      }
      frames.push({ frame, volume: input.volume });
    }

    if (!this.push(mixPcmFrames(frames, this.#masterVolume)) && this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }
}
