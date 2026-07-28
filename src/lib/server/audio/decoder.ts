import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { config } from '../config';
import { terminateProcess } from '../process';
import { ytdlpMediaUrlArgs } from '../youtube';

export type DecoderInput =
  { kind: 'file'; path: string; loop: boolean } | { kind: 'youtube'; url: string; loop: boolean };

export interface DecoderCallbacks {
  onData(chunk: Buffer): boolean;
  onPlaying(): void;
  onEnd(error: string | null): void;
}

export interface DecoderHandle {
  resume(): void;
  stop(): void;
}

function boundedLog(current: string, chunk: Buffer): string {
  return `${current}${chunk.toString('utf8')}`.slice(-4_000);
}

export function spawnDecoder(input: DecoderInput, callbacks: DecoderCallbacks): DecoderHandle {
  let stopped = false;
  let ffmpeg: ChildProcessWithoutNullStreams | null = null;
  let ytdlp: ChildProcess | null = null;
  let stderr = '';

  const startFfmpeg = (ffmpegInputArgs: string[]) => {
    if (stopped) return;
    const process: ChildProcessWithoutNullStreams = spawn(
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
    ffmpeg = process;
    process.stdin.end();

    let announcedPlaying = false;
    process.stdout.on('data', (chunk: Buffer) => {
      if (!announcedPlaying) {
        announcedPlaying = true;
        callbacks.onPlaying();
      }
      if (!callbacks.onData(chunk)) process.stdout.pause();
    });
    process.stderr.on('data', (chunk: Buffer) => {
      stderr = boundedLog(stderr, chunk);
    });
    process.once('error', (error) => {
      stderr = boundedLog(stderr, Buffer.from(error.message));
    });
    process.once('close', (code) => {
      if (ffmpeg === process) ffmpeg = null;
      if (stopped) return;
      const message =
        code === 0 ? null : stderr.trim() || `FFmpeg exited with code ${code ?? 'unknown'}.`;
      callbacks.onEnd(message);
    });
  };

  if (input.kind === 'youtube') {
    const resolver = spawn(config.ytdlpPath, ytdlpMediaUrlArgs(input.url), {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    ytdlp = resolver;
    let mediaUrlOutput = '';
    resolver.stdout.on('data', (chunk: Buffer) => {
      mediaUrlOutput = boundedLog(mediaUrlOutput, chunk);
    });
    resolver.stderr.on('data', (chunk: Buffer) => {
      stderr = boundedLog(stderr, chunk);
    });
    resolver.once('error', (error) => {
      stderr = boundedLog(stderr, Buffer.from(error.message));
    });
    resolver.once('close', (code) => {
      if (ytdlp === resolver) ytdlp = null;
      if (stopped) return;
      if (code !== 0) {
        callbacks.onEnd(
          stderr.trim() || `yt-dlp exited with code ${code ?? 'unknown'} while resolving media.`
        );
        return;
      }

      const mediaUrl = mediaUrlOutput
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);
      if (!mediaUrl || !/^https?:\/\//i.test(mediaUrl)) {
        callbacks.onEnd('yt-dlp did not return a playable HTTP media URL.');
        return;
      }
      startFfmpeg([...(input.loop ? ['-stream_loop', '-1'] : []), '-re', '-i', mediaUrl]);
    });
  } else {
    startFfmpeg([...(input.loop ? ['-stream_loop', '-1'] : []), '-re', '-i', input.path]);
  }

  return {
    resume() {
      ffmpeg?.stdout.resume();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      if (ytdlp) terminateProcess(ytdlp);
      terminateProcess(ffmpeg);
    }
  };
}
