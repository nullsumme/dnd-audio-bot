import { describe, expect, it } from 'vitest';
import { _parseCreateSceneInput, _validateSceneAssets } from './+server';

describe('scene collection requests', () => {
  it('accepts track-only and effect-only scene bodies', () => {
    expect(
      _parseCreateSceneInput({
        name: 'Exploration',
        description: 'Across the wilds',
        trackIds: ['track-1']
      })
    ).toEqual({
      name: 'Exploration',
      description: 'Across the wilds',
      trackIds: ['track-1'],
      effectIds: []
    });
    expect(
      _parseCreateSceneInput({
        name: 'Reactions',
        effectIds: ['effect-1']
      })
    ).toMatchObject({ trackIds: [], effectIds: ['effect-1'] });
  });

  it('rejects empty scenes, unknown fields and unsafe asset ids', () => {
    expect(() => _parseCreateSceneInput({ name: 'Empty' })).toThrow();
    expect(() =>
      _parseCreateSceneInput({
        name: 'Extra',
        trackIds: ['track-1'],
        autoplay: true
      })
    ).toThrow();
    expect(() =>
      _parseCreateSceneInput({
        name: 'Unsafe',
        trackIds: ['../track']
      })
    ).toThrow();
  });

  it('rejects unknown assets and role mismatches at the API boundary', () => {
    const assets = [
      { id: 'track-1', role: 'ambience' as const },
      { id: 'effect-1', role: 'soundboard' as const }
    ];
    expect(() =>
      _validateSceneAssets({ trackIds: ['track-1'], effectIds: ['effect-1'] }, assets)
    ).not.toThrow();
    expect(() => _validateSceneAssets({ trackIds: ['missing'] }, assets)).toThrow(
      'Background asset "missing" was not found'
    );
    expect(() => _validateSceneAssets({ trackIds: ['effect-1'] }, assets)).toThrow(
      'not assigned to the background library'
    );
    expect(() => _validateSceneAssets({ effectIds: ['track-1'] }, assets)).toThrow(
      'not assigned to the soundboard'
    );
  });
});
