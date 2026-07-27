import { describe, expect, it } from 'vitest';
import { normalizeYouTubeUrl } from './youtube';

describe('normalizeYouTubeUrl', () => {
  it.each([
    'https://youtube.com/watch?v=abc',
    'https://www.youtube.com/watch?v=abc',
    'https://music.youtube.com/watch?v=abc',
    'https://youtu.be/abc'
  ])('accepts %s', (url) => {
    expect(normalizeYouTubeUrl(url)).toBe(url);
  });

  it.each([
    'http://youtube.com/watch?v=abc',
    'https://youtube.com.example.org/watch?v=abc',
    'https://example.org/audio.mp3',
    'not a url'
  ])('rejects %s', (url) => {
    expect(() => normalizeYouTubeUrl(url)).toThrow();
  });
});
