import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { config } from '../config';
import { terminateProcess } from '../process';
import { BYTES_PER_FRAME } from './mixer';

export interface DecoderInput {
  path: string;
  loop: boolean;
  startMilliseconds?: number;
}

export interface DecoderCallbacks {
  onData(chunk: Buffer): boolean;
  onPlaying(): void;
  onEnd(error: string | null): void;
}

export interface DecoderHandle {
  resume(): void;
  stop(): Promise<void>;
}

export const DECODER_STOP_TIMEOUT_MILLISECONDS = 2_500;

function seekSeconds(milliseconds: number | undefined): string | null {
  if (milliseconds === undefined || milliseconds === 0) return null;
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
    throw new RangeError(
      'Decoder start offset must be a non-negative integer number of milliseconds.'
    );
  }
  return (milliseconds / 1_000).toFixed(3);
}

function boundedLog(current: string, chunk: Buffer): string {
  return `${current}${chunk.toString('utf8')}`.slice(-4_000);
}

export function spawnDecoder(input: DecoderInput, callbacks: DecoderCallbacks): DecoderHandle {
  let stopped = false;
  let ffmpeg: ChildProcessWithoutNullStreams | null = null;
  let stderr = '';
  let backpressured = false;
  let stdoutEnded = false;
  let stdoutClosed = false;
  let processClosed = false;
  let closeCode: number | null = null;
  let endAnnounced = false;
  let resolveClosed: () => void = () => {};
  let resolveExited: () => void = () => {};
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  const exited = new Promise<void>((resolve) => {
    resolveExited = resolve;
  });

  const start = seekSeconds(input.startMilliseconds);
  const process: ChildProcessWithoutNullStreams = spawn(
    config.ffmpegPath,
    [
      '-hide_banner',
      '-loglevel',
      'warning',
      '-probesize',
      '32768',
      '-analyzeduration',
      '0',
      '-threads',
      '1',
      '-filter_threads',
      '1',
      '-filter_complex_threads',
      '1',
      ...(input.loop ? ['-stream_loop', '-1'] : []),
      ...(start ? ['-ss', start] : []),
      '-i',
      input.path,
      '-map',
      '0:a:0',
      '-vn',
      '-ac',
      '2',
      '-ar',
      '48000',
      '-acodec',
      'pcm_s16le',
      '-f',
      's16le',
      'pipe:1'
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] }
  );
  ffmpeg = process;
  process.stdin.end();

  let announcedPlaying = false;
  const deliver = (chunk: Buffer): boolean => {
    if (!announcedPlaying) {
      announcedPlaying = true;
      callbacks.onPlaying();
    }
    return callbacks.onData(chunk);
  };
  const announceEnd = () => {
    if (stopped || endAnnounced || !processClosed || !stdoutEnded) return;
    endAnnounced = true;
    const message =
      closeCode === 0
        ? null
        : stderr.trim() || `FFmpeg exited with code ${closeCode ?? 'unknown'}.`;
    callbacks.onEnd(message);
  };
  const pump = () => {
    if (stopped) {
      while (process.stdout.read() !== null) {
        // Explicit shutdown discards buffered PCM instead of delivering it to a
        // mixer input that has already been detached.
      }
      return;
    }
    while (!backpressured) {
      const chunk = process.stdout.read(BYTES_PER_FRAME) as Buffer | null;
      if (chunk === null) break;
      if (!deliver(chunk)) backpressured = true;
    }
    if (stdoutClosed && process.stdout.readableLength === 0) stdoutEnded = true;
    announceEnd();
  };

  process.stdout.on('readable', pump);
  process.stdout.once('end', () => {
    stdoutEnded = true;
    announceEnd();
  });
  process.stdout.once('close', () => {
    stdoutClosed = true;
    pump();
  });
  process.stderr.on('data', (chunk: Buffer) => {
    stderr = boundedLog(stderr, chunk);
  });
  process.once('error', (error) => {
    stderr = boundedLog(stderr, Buffer.from(error.message));
  });
  process.once('exit', () => {
    resolveExited();
  });
  process.once('close', (code) => {
    if (ffmpeg === process) ffmpeg = null;
    processClosed = true;
    closeCode = code;
    resolveClosed();
    announceEnd();
  });

  return {
    resume() {
      if (!backpressured) return;
      backpressured = false;
      pump();
    },
    async stop() {
      if (!stopped) {
        stopped = true;
        backpressured = false;
        process.stdout.off('readable', pump);
        process.stdout.resume();
        terminateProcess(ffmpeg);
      }

      let timeout: NodeJS.Timeout | null = null;
      await Promise.race([
        closed,
        exited,
        new Promise<void>((resolve) => {
          timeout = setTimeout(() => {
            if (process.exitCode === null) process.kill('SIGKILL');
            process.stdout.destroy();
            process.stderr.destroy();
            process.stdin.destroy();
            resolve();
          }, DECODER_STOP_TIMEOUT_MILLISECONDS);
          timeout.unref();
        })
      ]);
      if (timeout) clearTimeout(timeout);
    }
  };
}
