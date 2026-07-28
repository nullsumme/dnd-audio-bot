import { describe, expect, it } from 'vitest';
import type { SceneCollection } from '$lib/types';
import { _parseUpdateSceneInput, _sceneAfterUpdate } from './+server';

const current: SceneCollection = {
  id: 'scene-1',
  name: 'Current',
  description: 'Existing scene',
  trackIds: ['track-1'],
  effectIds: ['effect-1'],
  createdAt: '2026-07-28T10:00:00.000Z',
  updatedAt: '2026-07-28T10:00:00.000Z'
};

describe('scene collection update requests', () => {
  it('parses partial updates and merges them for complete asset validation', () => {
    const update = _parseUpdateSceneInput({
      name: 'Updated',
      effectIds: ['effect-2']
    });
    expect(_sceneAfterUpdate(current, update)).toEqual({
      name: 'Updated',
      description: 'Existing scene',
      trackIds: ['track-1'],
      effectIds: ['effect-2']
    });
  });

  it('rejects empty, unknown and malformed update bodies', () => {
    expect(() => _parseUpdateSceneInput({})).toThrow();
    expect(() => _parseUpdateSceneInput({ id: 'replacement' })).toThrow();
    expect(() => _parseUpdateSceneInput({ trackIds: ['bad/id'] })).toThrow();
  });
});
