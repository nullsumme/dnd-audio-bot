import { describe, expect, it } from 'vitest';
import { _parseSourcePatch } from './+server';

describe('active audio source transport requests', () => {
  it('accepts independent and combined source updates', () => {
    expect(_parseSourcePatch({ paused: true })).toEqual({ paused: true });
    expect(
      _parseSourcePatch({
        volume: 0.5,
        paused: false,
        positionMilliseconds: 12_345,
        repeat: false
      })
    ).toEqual({
      volume: 0.5,
      paused: false,
      positionMilliseconds: 12_345,
      repeat: false
    });
  });

  it('rejects empty, unknown and invalid transport updates', () => {
    for (const value of [
      {},
      { action: 'pause' },
      { paused: 'yes' },
      { positionMilliseconds: -1 },
      { positionMilliseconds: 1.5 },
      { repeat: 'true' }
    ]) {
      expect(() => _parseSourcePatch(value)).toThrow();
    }
  });
});
