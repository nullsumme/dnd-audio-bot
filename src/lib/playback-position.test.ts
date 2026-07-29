import { describe, expect, it } from 'vitest';
import { interpolatePlaybackPosition } from './playback-position';

const observation = { positionMilliseconds: 10_000, observedAtMilliseconds: 1_000 };

describe('interpolatePlaybackPosition', () => {
  it('reports zero without an observation', () => {
    expect(
      interpolatePlaybackPosition({
        observation: null,
        playing: true,
        nowMilliseconds: 5_000,
        durationMilliseconds: 60_000,
        repeat: false
      })
    ).toBe(0);
  });

  it('holds the observed position while paused', () => {
    expect(
      interpolatePlaybackPosition({
        observation,
        playing: false,
        nowMilliseconds: 9_000,
        durationMilliseconds: 60_000,
        repeat: false
      })
    ).toBe(10_000);
  });

  it('adds elapsed wall-clock time while playing', () => {
    expect(
      interpolatePlaybackPosition({
        observation,
        playing: true,
        nowMilliseconds: 3_500,
        durationMilliseconds: 60_000,
        repeat: false
      })
    ).toBe(12_500);
  });

  it('clamps to the duration when repeat is off', () => {
    expect(
      interpolatePlaybackPosition({
        observation,
        playing: true,
        nowMilliseconds: 100_000,
        durationMilliseconds: 60_000,
        repeat: false
      })
    ).toBe(60_000);
  });

  it('wraps within the duration when repeat is on', () => {
    expect(
      interpolatePlaybackPosition({
        observation,
        playing: true,
        nowMilliseconds: 61_000,
        durationMilliseconds: 60_000,
        repeat: true
      })
    ).toBe(10_000);
  });

  it('returns the raw position when the duration is unknown', () => {
    expect(
      interpolatePlaybackPosition({
        observation,
        playing: true,
        nowMilliseconds: 3_000,
        durationMilliseconds: 0,
        repeat: false
      })
    ).toBe(12_000);
  });

  it('never reports a negative position when the clock runs backwards', () => {
    expect(
      interpolatePlaybackPosition({
        observation: { positionMilliseconds: 0, observedAtMilliseconds: 10_000 },
        playing: true,
        nowMilliseconds: 1_000,
        durationMilliseconds: 60_000,
        repeat: false
      })
    ).toBe(0);
  });
});
