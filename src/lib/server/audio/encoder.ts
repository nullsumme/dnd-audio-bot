import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { Readable } from 'node:stream';
import { DISCORD_OPUS_MAX_BITRATE, DISCORD_OPUS_MIN_BITRATE } from '$lib/audio-quality';
import { config } from '../config';
import { terminateProcess } from '../process';

// Discord dispatches one Opus packet every 20 ms. Keeping exactly one packet in
// each Ogg page avoids adding a second application-level playback queue.
export const DISCORD_OPUS_PAGE_MILLISECONDS = 20;

export function buildDiscordOpusArgs(bitrate: number): string[] {
  if (
    !Number.isSafeInteger(bitrate) ||
    bitrate < DISCORD_OPUS_MIN_BITRATE ||
    bitrate > DISCORD_OPUS_MAX_BITRATE
  ) {
    throw new RangeError(
      `Discord Opus bitrate must be between ${DISCORD_OPUS_MIN_BITRATE} and ${DISCORD_OPUS_MAX_BITRATE} bps.`
    );
  }
  return [
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
    `${bitrate}`,
    '-vbr',
    'constrained',
    '-application',
    'lowdelay',
    '-frame_duration',
    '20',
    '-packet_loss',
    '5',
    '-fec',
    '1',
    '-f',
    'ogg',
    '-page_duration',
    `${DISCORD_OPUS_PAGE_MILLISECONDS * 1_000}`,
    '-flush_packets',
    '1',
    'pipe:1'
  ];
}

export interface DiscordOpusPipeline {
  stream: Readable;
  releaseInput?(): void;
  promoteInput?(): void;
  stop(): Promise<void>;
}

export interface DiscordOpusEncoderOptions {
  isolatedInput?: boolean;
}

export interface DiscordOpusEncoderClose {
  code: number | null;
  signal: NodeJS.Signals | null;
  expected: boolean;
  message: string | null;
}

export interface DiscordOpusEncoderLifecycle {
  onError(message: string): void;
  onClose(event: DiscordOpusEncoderClose): void;
}

function boundedLog(current: string, chunk: Buffer): string {
  return `${current}${chunk.toString('utf8')}`.slice(-4_000);
}

export function spawnDiscordOpusEncoder(
  input: Readable,
  bitrate: number,
  lifecycle: DiscordOpusEncoderLifecycle,
  options: DiscordOpusEncoderOptions = {}
): DiscordOpusPipeline {
  let stopped = false;
  let inputBackpressured = false;
  let inputMode: 'detached' | 'isolated' | 'piped' = 'detached';
  let stderr = '';
  let resolveClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  const ffmpeg: ChildProcessWithoutNullStreams = spawn(
    config.ffmpegPath,
    buildDiscordOpusArgs(bitrate),
    {
      stdio: ['pipe', 'pipe', 'pipe']
    }
  );

  const onInputData = (chunk: Buffer) => {
    if (stopped || inputBackpressured) return;
    try {
      if (!ffmpeg.stdin.write(chunk)) {
        inputBackpressured = true;
        lifecycle.onError(
          'Discord Opus encoder warm-up input backpressured before it became playable.'
        );
      }
    } catch (error) {
      inputBackpressured = true;
      lifecycle.onError(
        `Discord Opus encoder: ${error instanceof Error ? error.message : 'input write failed'}`
      );
    }
  };
  const detachInput = () => {
    if (inputMode === 'isolated') input.off('data', onInputData);
    else if (inputMode === 'piped') input.unpipe(ffmpeg.stdin);
    inputMode = 'detached';
  };
  const promoteInput = () => {
    if (stopped || inputMode !== 'isolated') return;
    input.off('data', onInputData);
    inputMode = 'piped';
    input.pipe(ffmpeg.stdin);
  };
  if (options.isolatedInput) {
    inputMode = 'isolated';
    input.on('data', onInputData);
  } else {
    inputMode = 'piped';
    input.pipe(ffmpeg.stdin);
  }
  ffmpeg.stdin.on('error', (error: NodeJS.ErrnoException) => {
    if (!stopped && error.code !== 'EPIPE')
      lifecycle.onError(`Discord Opus encoder: ${error.message}`);
  });
  ffmpeg.stderr.on('data', (chunk: Buffer) => {
    stderr = boundedLog(stderr, chunk);
  });
  ffmpeg.once('error', (error) => {
    if (!stopped) lifecycle.onError(`Discord Opus encoder: ${error.message}`);
  });
  ffmpeg.once('close', (code, signal) => {
    detachInput();
    try {
      lifecycle.onClose({
        code,
        signal,
        expected: stopped,
        message:
          code === 0
            ? null
            : stderr.trim() || `Discord Opus encoder exited with code ${code ?? 'unknown'}.`
      });
    } finally {
      resolveClosed();
    }
  });

  return {
    stream: ffmpeg.stdout,
    releaseInput: detachInput,
    promoteInput,
    async stop() {
      if (!stopped) {
        stopped = true;
        detachInput();
        terminateProcess(ffmpeg);
      }
      await closed;
    }
  };
}
