import { describe, expect, it } from 'vitest';
import { _parsePlaybackPatch } from './+server';

describe('background playback requests', () => {
  it('accepts strict partial playback settings', () => {
    expect(_parsePlaybackPatch({ activeSceneId: null })).toEqual({ activeSceneId: null });
    expect(
      _parsePlaybackPatch({
        activeSceneId: 'scene-1',
        shuffle: true,
        repeatMode: 'all'
      })
    ).toEqual({
      activeSceneId: 'scene-1',
      shuffle: true,
      repeatMode: 'all'
    });
  });

  it('rejects empty, malformed, and unknown settings', () => {
    for (const value of [
      {},
      { activeSceneId: '../scene' },
      { shuffle: 'yes' },
      { repeatMode: 'track' },
      { shuffle: false, autoplay: true }
    ]) {
      expect(() => _parsePlaybackPatch(value)).toThrow();
    }
  });
});
