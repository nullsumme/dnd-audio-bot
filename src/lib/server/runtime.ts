import type { DiscordBitrateMode } from '$lib/audio-quality';
import type { ApplicationState, DiscordStatus } from '$lib/types';
import { AudioEngine } from './audio/engine';
import { SoundboardPcmCache } from './audio/pcm-cache';
import { config } from './config';
import { DiscordService } from './discord';
import { AudioLibrary } from './library';
import { commandAvailable } from './process';
import { ApplicationSettingsStore } from './settings';

export class ApplicationRuntime {
  readonly library = new AudioLibrary();
  readonly settings = new ApplicationSettingsStore();
  readonly pcmCache = new SoundboardPcmCache();
  readonly engine = new AudioEngine();
  readonly discord = new DiscordService(this.engine.mixer);
  capabilities = { ffmpeg: false, ffprobe: false };
  #initialization: Promise<void> | null = null;
  #bitrateMutationBarrier: Promise<void> = Promise.resolve();
  #shuttingDown = false;

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

  setDiscordBitrateMode(mode: DiscordBitrateMode): Promise<DiscordStatus> {
    if (this.#shuttingDown)
      return Promise.reject(new Error('The application runtime is shutting down.'));
    const operation = this.#bitrateMutationBarrier
      .catch(() => undefined)
      .then(() => this.#setDiscordBitrateMode(mode));
    this.#bitrateMutationBarrier = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }

  async #setDiscordBitrateMode(mode: DiscordBitrateMode): Promise<DiscordStatus> {
    await this.initialize();
    const previousMode = this.settings.discordBitrateMode;
    await this.settings.setDiscordBitrateMode(mode);
    try {
      return await this.discord.setBitrateMode(mode);
    } catch (error) {
      try {
        await this.settings.setDiscordBitrateMode(previousMode);
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          'The Discord bitrate change failed and its persisted setting could not be rolled back.'
        );
      }
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    this.#shuttingDown = true;
    await this.#bitrateMutationBarrier.catch(() => undefined);
    await this.discord.shutdown();
    this.engine.destroy();
    await this.pcmCache.shutdown();
  }

  async #initialize(): Promise<void> {
    await Promise.all([this.library.initialize(), this.settings.initialize()]);
    await this.discord.setBitrateMode(this.settings.discordBitrateMode);
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
