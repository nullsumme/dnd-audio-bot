import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { Readable } from 'node:stream';
import { config } from '../config';
import { terminateProcess } from '../process';

export const DISCORD_OPUS_BITRATE = 64_000;
export const DISCORD_OPUS_BUFFER_MILLISECONDS = 200;

export const DISCORD_OPUS_ARGS = [
  '-hide_banner',
  '-loglevel',
  'warning',
  '-f',
  's16le',
  '-ar',
  '48000',
  '-ac',
  '2',
  '-i',
  'pipe:0',
  '-map',
  '0:a:0',
  '-vn',
  '-c:a',
  'libopus',
  '-b:a',
  `${DISCORD_OPUS_BITRATE}`,
  '-vbr',
  'constrained',
  '-application',
  'audio',
  '-frame_duration',
  '20',
  '-packet_loss',
  '5',
  '-fec',
  '1',
  '-f',
  'ogg',
  '-page_duration',
  `${DISCORD_OPUS_BUFFER_MILLISECONDS * 1_000}`,
  'pipe:1'
] as const;

export interface DiscordOpusPipeline {
  stream: Readable;
  stop(): void;
}

function boundedLog(current: string, chunk: Buffer): string {
  return `${current}${chunk.toString('utf8')}`.slice(-4_000);
}

export function spawnDiscordOpusEncoder(
  input: Readable,
  onError: (message: string) => void
): DiscordOpusPipeline {
  let stopped = false;
  let stderr = '';
  const ffmpeg: ChildProcessWithoutNullStreams = spawn(config.ffmpegPath, [...DISCORD_OPUS_ARGS], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  input.pipe(ffmpeg.stdin);
  ffmpeg.stdin.on('error', (error: NodeJS.ErrnoException) => {
    if (!stopped && error.code !== 'EPIPE') onError(`Discord Opus encoder: ${error.message}`);
  });
  ffmpeg.stderr.on('data', (chunk: Buffer) => {
    stderr = boundedLog(stderr, chunk);
  });
  ffmpeg.once('error', (error) => {
    if (!stopped) onError(`Discord Opus encoder: ${error.message}`);
  });
  ffmpeg.once('close', (code) => {
    input.unpipe(ffmpeg.stdin);
    if (!stopped && code !== 0) {
      onError(stderr.trim() || `Discord Opus encoder exited with code ${code ?? 'unknown'}.`);
    }
  });

  return {
    stream: ffmpeg.stdout,
    stop() {
      if (stopped) return;
      stopped = true;
      input.unpipe(ffmpeg.stdin);
      terminateProcess(ffmpeg);
    }
  };
}
