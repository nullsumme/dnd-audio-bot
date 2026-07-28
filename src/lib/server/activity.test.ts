import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActivityLog, DEFAULT_ACTIVITY_LOG_CAPACITY } from './activity';

describe('ActivityLog', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns immutable entries newest-first with stable unique ids and timestamps', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T10:00:00.000Z'));
    const activity = new ActivityLog();
    const connected = activity.record('discord', 'connect', 'Connected to Table');

    vi.setSystemTime(new Date('2026-07-28T10:01:00.000Z'));
    const played = activity.record('audio', 'play', 'Played Dragon roar');

    expect(activity.capacity).toBe(DEFAULT_ACTIVITY_LOG_CAPACITY);
    expect(activity.size).toBe(2);
    expect(activity.snapshot()).toEqual([played, connected]);
    expect(activity.snapshot().map((entry) => entry.id)).toEqual([played.id, connected.id]);
    expect(new Set([played.id, connected.id]).size).toBe(2);
    expect(connected).toMatchObject({
      category: 'discord',
      action: 'connect',
      message: 'Connected to Table',
      createdAt: '2026-07-28T10:00:00.000Z'
    });
    expect(Object.isFrozen(connected)).toBe(true);

    const snapshot = activity.snapshot();
    snapshot.pop();
    expect(activity.snapshot()).toHaveLength(2);
  });

  it('evicts the oldest entries when its configurable capacity wraps', () => {
    const activity = new ActivityLog(2);
    const first = activity.record('library', 'upload', 'Uploaded Rain');
    const second = activity.record('settings', 'update', 'Changed master volume');
    const third = activity.record('audio', 'play', 'Played Thunder');

    expect(activity.size).toBe(2);
    expect(activity.snapshot()).toEqual([third, second]);
    expect(activity.snapshot()).not.toContain(first);

    const fourth = activity.record('audio', 'stop', 'Stopped ambience');
    expect(activity.size).toBe(2);
    expect(activity.snapshot()).toEqual([fourth, third]);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid capacity %s',
    (capacity) => {
      expect(() => new ActivityLog(capacity)).toThrow(RangeError);
    }
  );
});
