import type { ApplicationState } from '$lib/types';
import { AudioEngine } from './audio/engine';
import { SoundboardPcmCache } from './audio/pcm-cache';
import { config } from './config';
import { DiscordService } from './discord';
import { AudioLibrary } from './library';
import { commandAvailable } from './process';

export class ApplicationRuntime {
  readonly library = new AudioLibrary();
  readonly pcmCache = new SoundboardPcmCache();
  readonly engine = new AudioEngine();
  readonly discord = new DiscordService(this.engine.mixer);
  capabilities = { ffmpeg: false, ffprobe: false };
  #initialization: Promise<void> | null = null;

  initialize(): Promise<void> {
    if (this.#initialization) return this.#initialization;
    this.#initialization = this.#initialize();
    return this.#initialization;
  }

  async snapshot(): Promise<ApplicationState> {
    await this.initialize();
    return {
      discord: this.discord.status(),
      guilds: this.discord.guilds(),
      sources: this.engine.list(),
      assets: this.library.list(),
      masterVolume: this.engine.masterVolume,
      pcmCache: this.pcmCache.status(),
      capabilities: { ...this.capabilities }
    };
  }

  isReady(): boolean {
    return this.discord.status().ready && this.capabilities.ffmpeg && this.capabilities.ffprobe;
  }

  async shutdown(): Promise<void> {
    await this.discord.shutdown();
    this.engine.destroy();
    await this.pcmCache.shutdown();
  }

  async #initialize(): Promise<void> {
    await this.library.initialize();
    const [ffmpeg, ffprobe] = await Promise.all([
      commandAvailable(config.ffmpegPath, ['-version']),
      commandAvailable(config.ffprobePath, ['-version'])
    ]);
    this.capabilities = { ffmpeg, ffprobe };
    await this.discord.start();
    if (ffmpeg) {
      void this.pcmCache.prewarm(this.library.list(), (asset) => this.library.filePath(asset));
    }
  }
}

const globalRuntime = globalThis as typeof globalThis & {
  __dndAudioRuntime?: ApplicationRuntime;
};

export const runtime = globalRuntime.__dndAudioRuntime ?? new ApplicationRuntime();
globalRuntime.__dndAudioRuntime = runtime;
