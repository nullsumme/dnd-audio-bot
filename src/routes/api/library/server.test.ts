import { describe, expect, it } from 'vitest';
import { _parseUploadMetadata } from './+server';

describe('library upload request metadata', () => {
  it('parses Unicode metadata from query parameters', () => {
    const url = new URL('http://soundkeep.test/api/library');
    url.search = new URLSearchParams({
      filename: 'Donnerstoß.mp3',
      name: 'Donnerstoß',
      category: 'Effekte',
      role: 'soundboard'
    }).toString();

    expect(_parseUploadMetadata(url)).toEqual({
      filename: 'Donnerstoß.mp3',
      name: 'Donnerstoß',
      category: 'Effekte',
      role: 'soundboard'
    });
  });

  it('rejects missing roles and oversized metadata', () => {
    const missingRole = new URL(
      'http://soundkeep.test/api/library?filename=sound.mp3&name=Sound&category=Effects'
    );
    expect(() => _parseUploadMetadata(missingRole)).toThrow();

    const oversized = new URL('http://soundkeep.test/api/library');
    oversized.search = new URLSearchParams({
      filename: 'sound.mp3',
      name: 'x'.repeat(101),
      category: 'Effects',
      role: 'soundboard'
    }).toString();
    expect(() => _parseUploadMetadata(oversized)).toThrow();
  });
});
