import { randomUUID } from 'node:crypto';
import type { ActivityAction, ActivityCategory, ActivityEntry } from '$lib/types';

export const DEFAULT_ACTIVITY_LOG_CAPACITY = 100;

export class ActivityLog {
  readonly capacity: number;
  #entries: Array<ActivityEntry | undefined>;
  #nextIndex = 0;
  #size = 0;

  constructor(capacity = DEFAULT_ACTIVITY_LOG_CAPACITY) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new RangeError('Activity log capacity must be a positive safe integer.');
    }
    this.capacity = capacity;
    this.#entries = new Array<ActivityEntry | undefined>(capacity);
  }

  get size(): number {
    return this.#size;
  }

  record(category: ActivityCategory, action: ActivityAction, message: string): ActivityEntry {
    const entry = Object.freeze({
      id: randomUUID(),
      category,
      action,
      message,
      createdAt: new Date().toISOString()
    });
    this.#entries[this.#nextIndex] = entry;
    this.#nextIndex = (this.#nextIndex + 1) % this.capacity;
    this.#size = Math.min(this.#size + 1, this.capacity);
    return entry;
  }

  snapshot(): ActivityEntry[] {
    const entries: ActivityEntry[] = [];
    for (let offset = 1; offset <= this.#size; offset += 1) {
      const index = (this.#nextIndex - offset + this.capacity) % this.capacity;
      const entry = this.#entries[index];
      if (entry) entries.push(entry);
    }
    return entries;
  }
}
