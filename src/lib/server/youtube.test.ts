import { describe, expect, it, vi } from 'vitest';

const childProcess = vi.hoisted(() => ({
  execFile: vi.fn(
    (
      _file: string,
      _args: readonly string[],
      _options: object,
      callback: (error: Error | null, stdout: string, stderr: string) => void
    ) => callback(null, '', '')
  )
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFile: childProcess.execFile };
});

import { downloadYouTubeMp3, normalizeYouTubeUrl } from './youtube';

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

  it('downloads one best-audio item and converts it to the controlled MP3 output template', async () => {
    await downloadYouTubeMp3('https://youtu.be/abc', '/data/audio/.download/source.%(ext)s');

    const [executable, args] = childProcess.execFile.mock.calls[0];
    expect(executable).toBe('yt-dlp');
    expect(args).toEqual(
      expect.arrayContaining([
        '--ignore-config',
        '--no-playlist',
        '--format',
        'bestaudio/best',
        '--extract-audio',
        '--audio-format',
        'mp3',
        '--output',
        '/data/audio/.download/source.%(ext)s',
        '--',
        'https://youtu.be/abc'
      ])
    );
  });
});
