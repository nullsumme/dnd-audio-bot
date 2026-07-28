import { describe, expect, it } from 'vitest';
import { _resolvePlaybackRole } from './+server';

describe('audio asset playback placement', () => {
  it('uses the persisted placement and rejects cross-line overrides', () => {
    expect(_resolvePlaybackRole('soundboard')).toBe('soundboard');
    expect(_resolvePlaybackRole('soundboard', 'soundboard')).toBe('soundboard');
    expect(() => _resolvePlaybackRole('ambience', 'soundboard')).toThrow(
      'must match the asset library placement'
    );
  });
});
