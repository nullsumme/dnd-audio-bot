import { describe, expect, it } from 'vitest';
import { _resolvePlaybackRole } from './+server';

describe('audio asset playback placement', () => {
  it('uses the persisted role by default and preserves explicit line overrides', () => {
    expect(_resolvePlaybackRole('soundboard')).toBe('soundboard');
    expect(_resolvePlaybackRole('soundboard', 'soundboard')).toBe('soundboard');
    expect(_resolvePlaybackRole('ambience', 'soundboard')).toBe('soundboard');
  });
});
