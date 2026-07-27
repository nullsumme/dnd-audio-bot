import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { config } from '../config';
import { terminateProcess } from '../process';
import { ytdlpStreamArgs } from '../youtube';

export type DecoderInput =
  { kind: 'file'; path: string; loop: boolean } | { kind: 'youtube'; url: string };

export interface DecoderCallbacks {
  onData(chunk: Buffer): void;
  onPlaying(): void;
  onEnd(error: string | null): void;
}

export interface DecoderHandle {
  stop(): void;
}

function boundedLog(current: string, chunk: Buffer): string {
  return `${current}${chunk.toString('utf8')}`.slice(-4_000);
}

export function spawnDecoder(input: DecoderInput, callbacks: DecoderCallbacks): DecoderHandle {
  let stopped = false;
  let ffmpeg: ChildProcessWithoutNullStreams;
  let ytdlp: ChildProcess | null = null;
  let stderr = '';

  const ffmpegInputArgs =
    input.kind === 'file'
      ? [...(input.loop ? ['-stream_loop', '-1'] : []), '-re', '-i', input.path]
      : ['-re', '-i', 'pipe:0'];

  ffmpeg = spawn(
    config.ffmpegPath,
    [
      '-hide_banner',
      '-loglevel',
      'warning',
      ...ffmpegInputArgs,
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

  if (input.kind === 'youtube') {
    const ytdlpProcess = spawn(config.ytdlpPath, ytdlpStreamArgs(input.url), {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    ytdlp = ytdlpProcess;
    ytdlpProcess.stdout.pipe(ffmpeg.stdin);
    ytdlpProcess.stderr.on('data', (chunk: Buffer) => {
      stderr = boundedLog(stderr, chunk);
    });
    ytdlpProcess.once('error', (error) => {
      stderr = boundedLog(stderr, Buffer.from(error.message));
      terminateProcess(ffmpeg);
    });
  } else {
    ffmpeg.stdin.end();
  }

  let announcedPlaying = false;
  ffmpeg.stdout.on('data', (chunk: Buffer) => {
    if (!announcedPlaying) {
      announcedPlaying = true;
      callbacks.onPlaying();
    }
    callbacks.onData(chunk);
  });
  ffmpeg.stderr.on('data', (chunk: Buffer) => {
    stderr = boundedLog(stderr, chunk);
  });
  ffmpeg.once('error', (error) => {
    stderr = boundedLog(stderr, Buffer.from(error.message));
  });
  ffmpeg.once('close', (code) => {
    if (ytdlp) terminateProcess(ytdlp);
    if (stopped) return;
    const message =
      code === 0 ? null : stderr.trim() || `FFmpeg exited with code ${code ?? 'unknown'}.`;
    callbacks.onEnd(message);
  });

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      if (ytdlp) terminateProcess(ytdlp);
      terminateProcess(ffmpeg);
    }
  };
}
