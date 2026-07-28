import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from './config';

const execFileAsync = promisify(execFile);

export interface YouTubeMetadata {
  title: string;
  duration: number | null;
  url: string;
}

export function normalizeYouTubeUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error('Enter a valid YouTube URL.');
  }

  if (url.protocol !== 'https:') throw new Error('YouTube URLs must use HTTPS.');
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  const allowed =
    hostname === 'youtu.be' || hostname === 'youtube.com' || hostname.endsWith('.youtube.com');
  if (!allowed) throw new Error('Only youtube.com and youtu.be URLs are supported.');

  return url.toString();
}

function commonArgs(): string[] {
  const args = ['--ignore-config', '--js-runtimes', 'node', '--no-playlist', '--no-warnings'];
  if (config.ytdlpCookiesFile) args.push('--cookies', config.ytdlpCookiesFile);
  return args;
}

export function ytdlpMediaUrlArgs(url: string): string[] {
  return [
    ...commonArgs(),
    '--quiet',
    '--format',
    'bestaudio/best',
    '--get-url',
    '--',
    normalizeYouTubeUrl(url)
  ];
}

export async function inspectYouTube(input: string): Promise<YouTubeMetadata> {
  const url = normalizeYouTubeUrl(input);
  const { stdout } = await execFileAsync(
    config.ytdlpPath,
    [...commonArgs(), '--dump-single-json', '--skip-download', '--', url],
    {
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024
    }
  );
  const result = JSON.parse(stdout) as { title?: unknown; duration?: unknown };
  return {
    title:
      typeof result.title === 'string' && result.title.trim()
        ? result.title.trim()
        : 'YouTube ambience',
    duration: typeof result.duration === 'number' && result.duration >= 0 ? result.duration : null,
    url
  };
}

export async function downloadYouTubeMp3(input: string, outputTemplate: string): Promise<void> {
  const url = normalizeYouTubeUrl(input);
  await execFileAsync(
    config.ytdlpPath,
    [
      ...commonArgs(),
      '--quiet',
      '--format',
      'bestaudio/best',
      '--extract-audio',
      '--audio-format',
      'mp3',
      '--audio-quality',
      '0',
      '--output',
      outputTemplate,
      '--',
      url
    ],
    {
      timeout: 15 * 60_000,
      maxBuffer: 10 * 1024 * 1024
    }
  );
}
