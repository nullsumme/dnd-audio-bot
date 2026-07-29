import type { DiscordBitrateMode } from '$lib/audio-quality';
import type { ApplicationState, DiscordStatus } from '$lib/types';
import { ActivityLog } from './activity';
import { AudioEngine } from './audio/engine';
import { SoundboardPcmCache } from './audio/pcm-cache';
import { config } from './config';
import { DiscordService } from './discord';
import { AudioLibrary } from './library';
import { BackgroundPlaybackCoordinator } from './playback';
import { commandAvailable } from './process';
import { SceneStore } from './scenes';
import { ApplicationSettingsStore } from './settings';

export class ApplicationRuntime {
  readonly library = new AudioLibrary();
  readonly scenes = new SceneStore();
  readonly settings = new ApplicationSettingsStore();
  readonly activity = new ActivityLog(config.activityLogCapacity);
  readonly pcmCache = new SoundboardPcmCache();
  readonly engine = new AudioEngine();
  readonly playback = new BackgroundPlaybackCoordinator(this.library, this.scenes, this.engine);
  readonly discord = new DiscordService(this.engine.mixer);
  capabilities = { ffmpeg: false, ffprobe: false };
  #initialization: Promise<void> | null = null;
  #bitrateMutationBarrier: Promise<void> = Promise.resolve();
  #catalogMutationBarrier: Promise<void> = Promise.resolve();
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
      scenes: this.scenes.list(),
      activity: this.activity.snapshot(),
      playback: this.playback.snapshot(),
      masterVolume: this.engine.masterVolume,
      pcmCache: this.pcmCache.status(),
      capabilities: { ...this.capabilities }
    };
  }

  isReady(): boolean {
    return this.discord.status().ready && this.capabilities.ffmpeg && this.capabilities.ffprobe;
  }

  mutateCatalog<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#shuttingDown) {
      return Promise.reject(new Error('The application runtime is shutting down.'));
    }
    const result = this.#catalogMutationBarrier.then(operation, operation);
    this.#catalogMutationBarrier = result.then(
      () => undefined,
      () => undefined
    );
    return result;
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
    await Promise.all([
      this.#bitrateMutationBarrier.catch(() => undefined),
      this.#catalogMutationBarrier.catch(() => undefined)
    ]);
    await this.discord.shutdown();
    this.playback.destroy();
    this.engine.destroy();
    await this.pcmCache.shutdown();
  }

  async #initialize(): Promise<void> {
    await Promise.all([
      this.library.initialize(),
      this.scenes.initialize(),
      this.settings.initialize()
    ]);
    await this.#reconcileSceneReferences();
    await this.playback.reconcile();
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

  async #reconcileSceneReferences(): Promise<void> {
    const roles = new Map(this.library.list().map((asset) => [asset.id, asset.role]));
    const invalidIds = new Set<string>();
    for (const scene of this.scenes.list()) {
      for (const id of scene.trackIds) {
        if (roles.get(id) !== 'ambience') invalidIds.add(id);
      }
      for (const id of scene.effectIds) {
        if (roles.get(id) !== 'soundboard') invalidIds.add(id);
      }
    }
    for (const id of invalidIds) {
      await this.scenes.removeAssetReferences(id);
    }
  }
}

const globalRuntime = globalThis as typeof globalThis & {
  __dndAudioRuntime?: ApplicationRuntime;
};

export const runtime = globalRuntime.__dndAudioRuntime ?? new ApplicationRuntime();
globalRuntime.__dndAudioRuntime = runtime;
