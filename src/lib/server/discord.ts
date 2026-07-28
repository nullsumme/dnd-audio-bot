import {
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  type AudioResource,
  type VoiceConnection
} from '@discordjs/voice';
import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  type Guild,
  type VoiceBasedChannel
} from 'discord.js';
import { resolveDiscordOpusBitrate, type DiscordBitrateMode } from '$lib/audio-quality';
import type { DiscordStatus, GuildSummary } from '$lib/types';
import { config } from './config';
import {
  DISCORD_OPUS_PAGE_MILLISECONDS,
  spawnDiscordOpusEncoder,
  type DiscordOpusEncoderLifecycle,
  type DiscordOpusPipeline
} from './audio/encoder';
import type { PcmMixer } from './audio/mixer';

export const DISCORD_AUDIO_RETRY_BASE_MILLISECONDS = 250;
export const DISCORD_AUDIO_RETRY_MAX_MILLISECONDS = 5_000;
export const DISCORD_LOGIN_RETRY_BASE_MILLISECONDS = 1_000;
export const DISCORD_LOGIN_RETRY_MAX_MILLISECONDS = 30_000;
export const DISCORD_VOICE_RECOVERY_MILLISECONDS = 10_000;
export const DISCORD_BITRATE_PRIME_FRAMES = 3;
export const DISCORD_BITRATE_PRIME_TIMEOUT_MILLISECONDS = 500;
export const DISCORD_BITRATE_RETRY_BASE_MILLISECONDS = 250;
export const DISCORD_BITRATE_RETRY_MAX_MILLISECONDS = 5_000;

interface DiscordAudioPipeline extends DiscordOpusPipeline {
  inputType: StreamType;
}

type AudioPipelineFactory = (
  mixer: PcmMixer,
  bitrate: number,
  lifecycle: DiscordOpusEncoderLifecycle,
  isolatedInput: boolean
) => DiscordAudioPipeline;

const createDefaultAudioPipeline: AudioPipelineFactory = (
  mixer,
  bitrate,
  lifecycle,
  isolatedInput
) => ({
  ...spawnDiscordOpusEncoder(mixer, bitrate, lifecycle, { isolatedInput }),
  inputType: StreamType.OggOpus
});

interface OwnedConnection {
  generation: number;
  connection: VoiceConnection;
  guild: Guild;
  recovery: Promise<void> | null;
}

interface OwnedAudioPipeline {
  generation: number;
  connectionGeneration: number;
  bitrate: number;
  pipeline: DiscordAudioPipeline;
}

interface CandidateAudioPipeline extends OwnedAudioPipeline {
  resource: AudioResource;
  abortController: AbortController;
  promote(): void;
  activate(): void;
  stop(): Promise<void>;
}

function retryDelay(attempt: number, base: number, maximum: number): number {
  return Math.min(maximum, base * 2 ** Math.min(attempt, 20));
}

function abortError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error('Audio bitrate change was cancelled.');
}

async function waitForBufferedFrames(
  resource: AudioResource,
  signal: AbortSignal,
  frames = DISCORD_BITRATE_PRIME_FRAMES
): Promise<void> {
  if (resource.playStream.readableLength >= frames) return;
  await new Promise<void>((resolve, reject) => {
    const stream = resource.playStream;
    const timer = setTimeout(() => {
      finish(
        new Error(
          `The replacement Opus encoder did not produce ${frames} packets within ${DISCORD_BITRATE_PRIME_TIMEOUT_MILLISECONDS} ms.`
        )
      );
    }, DISCORD_BITRATE_PRIME_TIMEOUT_MILLISECONDS);
    timer.unref();

    const cleanup = () => {
      clearTimeout(timer);
      stream.off('readable', onReadable);
      stream.off('error', onError);
      stream.off('end', onEnd);
      stream.off('close', onEnd);
      signal.removeEventListener('abort', onAbort);
    };
    const finish = (error?: Error) => {
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onReadable = () => {
      if (stream.readableLength >= frames) finish();
    };
    const onError = (error: Error) => finish(error);
    const onEnd = () => finish(new Error('The replacement Opus encoder ended during warm-up.'));
    const onAbort = () => finish(abortError(signal.reason));

    stream.on('readable', onReadable);
    stream.once('error', onError);
    stream.once('end', onEnd);
    stream.once('close', onEnd);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    else onReadable();
  });
}

export class DiscordService {
  readonly client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
  });
  readonly player = createAudioPlayer({
    behaviors: {
      noSubscriber: NoSubscriberBehavior.Pause,
      maxMissedFrames: 50
    }
  });
  #mixer: PcmMixer;
  #createAudioPipeline: AudioPipelineFactory;
  #discordToken: string;
  #connection: OwnedConnection | null = null;
  #opusPipeline: OwnedAudioPipeline | null = null;
  #connectRequestSequence = 0;
  #connectionGeneration = 0;
  #pipelineGeneration = 0;
  #pipelineStopBarrier: Promise<void> = Promise.resolve();
  #candidateCleanupBarrier: Promise<void> = Promise.resolve();
  #bitrateMode: DiscordBitrateMode;
  #bitrateModeRevision = 0;
  #bitrateRequestSequence = 0;
  #bitrateReconfigureBarrier: Promise<void> = Promise.resolve();
  #bitrateReconfigureError: Error | null = null;
  #bitrateReconfiguring = false;
  #bitrateCandidate: CandidateAudioPipeline | null = null;
  #bitrateRetryAttempt = 0;
  #bitrateRetryTimer: NodeJS.Timeout | null = null;
  #fillerFramesOffset = 0;
  #connectionExpected = false;
  #audioRetryAttempt = 0;
  #audioRetryTimer: NodeJS.Timeout | null = null;
  #loginRetryAttempt = 0;
  #loginRetryTimer: NodeJS.Timeout | null = null;
  #loginPromise: Promise<void> | null = null;
  #loginDesired = false;
  #error: string | null = null;
  #shuttingDown = false;

  constructor(
    mixer: PcmMixer,
    createAudioPipeline = createDefaultAudioPipeline,
    discordToken = config.discordToken,
    bitrateMode = config.discordOpusBitrateMode
  ) {
    this.#mixer = mixer;
    this.#createAudioPipeline = createAudioPipeline;
    this.#discordToken = discordToken;
    this.#bitrateMode = bitrateMode;
    this.player.on('error', (error) => {
      const owned = this.#opusPipeline;
      if (!owned) return;
      if (this.#bitrateCandidate?.generation === owned.generation) {
        this.#bitrateCandidate.abortController.abort(error);
        return;
      }
      this.#failAudioPipeline(owned.generation, `Discord audio player: ${error.message}`);
    });
    this.player.on(AudioPlayerStatus.Idle, () => {
      const owned = this.#opusPipeline;
      if (!owned || !this.#isConnectionExpected(owned.connectionGeneration)) return;
      if (this.#bitrateCandidate?.generation === owned.generation) {
        this.#bitrateCandidate.abortController.abort(
          new Error('Discord rejected the replacement audio resource.')
        );
        return;
      }
      this.#failAudioPipeline(owned.generation, 'Discord audio player stopped unexpectedly.');
    });
    this.player.on(AudioPlayerStatus.Playing, () => {
      if (this.#opusPipeline) {
        this.#audioRetryAttempt = 0;
        if (this.#error?.startsWith('Discord audio')) this.#error = null;
      }
    });
    this.client.on('error', (error) => {
      this.#error = `Discord client: ${error.message}`;
      console.error(this.#error);
    });
    this.client.on(Events.ChannelUpdate, (oldChannel, newChannel) => {
      if (
        oldChannel.id !== newChannel.id ||
        newChannel.id !== this.#connectedChannel()?.id ||
        !('bitrate' in oldChannel) ||
        !('bitrate' in newChannel) ||
        oldChannel.bitrate === newChannel.bitrate
      )
        return;
      this.#clearBitrateRetry();
      const { completion } = this.#requestBitrateReconfigure();
      void completion.then(
        () => this.#clearBitrateRetry(),
        (error) => {
          this.#error =
            error instanceof Error
              ? `Discord audio bitrate: ${error.message}`
              : 'Discord audio bitrate change failed.';
          console.error(this.#error);
          this.#scheduleBitrateRetry();
        }
      );
    });
  }

  async prepareAudio(): Promise<void> {
    await this.#prepareAudio(this.#connection?.generation ?? this.#connectionGeneration);
  }

  async #prepareAudio(connectionGeneration: number): Promise<number> {
    if (this.#opusPipeline) return this.#opusPipeline.generation;
    await Promise.all([this.#pipelineStopBarrier, this.#candidateCleanupBarrier]);
    if (!this.#isConnectionExpected(connectionGeneration))
      throw new Error('The Discord voice connection is no longer available.');
    if (this.#connection?.connection.state.status !== VoiceConnectionStatus.Ready)
      throw new Error('The Discord voice connection is not ready.');
    const existingPipeline = this.#opusPipeline as OwnedAudioPipeline | null;
    if (existingPipeline) return existingPipeline.generation;
    const channel = this.#connectedChannel();
    if (!channel) throw new Error('The connected Discord voice channel is unavailable.');
    const bitrate = resolveDiscordOpusBitrate(this.#bitrateMode, channel.bitrate);
    const generation = ++this.#pipelineGeneration;
    const pipeline = this.#createAudioPipeline(
      this.#mixer,
      bitrate,
      {
        onError: (message) =>
          this.#failAudioPipeline(generation, `Discord audio pipeline: ${message}`),
        onClose: (event) => {
          if (event.expected) return;
          this.#failAudioPipeline(
            generation,
            event.message
              ? `Discord audio pipeline: ${event.message}`
              : 'Discord audio pipeline: Opus encoder exited unexpectedly.'
          );
        }
      },
      false
    );
    const owned = { generation, connectionGeneration, bitrate, pipeline };
    try {
      const resource = createAudioResource(pipeline.stream, {
        inputType: pipeline.inputType
      });
      this.#opusPipeline = owned;
      this.player.play(resource);
    } catch (error) {
      if (this.#opusPipeline === owned) this.#opusPipeline = null;
      await pipeline.stop().catch((stopError) => {
        console.error(
          `Discord audio pipeline shutdown: ${
            stopError instanceof Error ? stopError.message : 'unknown encoder shutdown error'
          }`
        );
      });
      throw error;
    }
    return generation;
  }

  async setBitrateMode(mode: DiscordBitrateMode): Promise<DiscordStatus> {
    if (this.#shuttingDown) throw new Error('The Discord service is shutting down.');
    this.#clearBitrateRetry();
    const previousMode = this.#bitrateMode;
    const changed = mode !== previousMode;
    if (changed) {
      this.#bitrateMode = mode;
      this.#bitrateModeRevision += 1;
    }
    const revision = this.#bitrateModeRevision;
    const { completion } = this.#requestBitrateReconfigure();
    try {
      await completion;
      return this.status();
    } catch (error) {
      if (changed && this.#bitrateModeRevision === revision) {
        this.#bitrateMode = previousMode;
        this.#bitrateModeRevision += 1;
        const { completion: rollback } = this.#requestBitrateReconfigure();
        await rollback.catch((rollbackError) => {
          this.#error = `Discord audio bitrate rollback: ${
            rollbackError instanceof Error ? rollbackError.message : 'replacement failed.'
          }`;
          console.error(this.#error);
          this.#scheduleBitrateRetry();
        });
      }
      throw error;
    }
  }

  #requestBitrateReconfigure(): { sequence: number; completion: Promise<void> } {
    const sequence = ++this.#bitrateRequestSequence;
    this.#bitrateReconfiguring = true;
    this.#bitrateReconfigureError = null;
    void this.#cancelBitrateCandidate('A newer audio bitrate request replaced this one.');
    const operation = this.#bitrateReconfigureBarrier.then(() =>
      this.#reconfigureBitrate(sequence)
    );
    this.#bitrateReconfigureBarrier = operation.then(
      () => {
        if (sequence === this.#bitrateRequestSequence) this.#bitrateReconfigureError = null;
      },
      (error) => {
        if (sequence === this.#bitrateRequestSequence)
          this.#bitrateReconfigureError = abortError(error);
      }
    );
    return { sequence, completion: this.#awaitBitrateConvergence() };
  }

  async #awaitBitrateConvergence(): Promise<void> {
    while (true) {
      const barrier = this.#bitrateReconfigureBarrier;
      await barrier;
      if (barrier !== this.#bitrateReconfigureBarrier) continue;
      this.#bitrateReconfiguring = false;
      if (this.#bitrateReconfigureError) throw this.#bitrateReconfigureError;
      const owned = this.#opusPipeline;
      const channel = this.#connectedChannel();
      if (
        owned &&
        channel &&
        owned.bitrate !== resolveDiscordOpusBitrate(this.#bitrateMode, channel.bitrate)
      ) {
        throw new Error('The active Opus encoder did not reach the requested bitrate.');
      }
      return;
    }
  }

  async #reconfigureBitrate(sequence: number): Promise<void> {
    await Promise.all([this.#pipelineStopBarrier, this.#candidateCleanupBarrier]);
    if (sequence !== this.#bitrateRequestSequence) return;
    const owned = this.#opusPipeline;
    const connection = this.#connection;
    const channel = this.#connectedChannel();
    if (
      !owned ||
      !connection ||
      !channel ||
      connection.generation !== owned.connectionGeneration ||
      connection.connection.state.status !== VoiceConnectionStatus.Ready
    )
      return;

    const bitrate = resolveDiscordOpusBitrate(this.#bitrateMode, channel.bitrate);
    if (owned.bitrate === bitrate) return;
    let candidate: CandidateAudioPipeline | null = null;
    try {
      candidate = await this.#createBitrateCandidate(connection.generation, bitrate);
    } catch (error) {
      if (sequence !== this.#bitrateRequestSequence) return;
      throw error;
    }
    if (sequence !== this.#bitrateRequestSequence) {
      await this.#stopBitrateCandidate(candidate);
      return;
    }
    this.#bitrateCandidate = candidate;

    try {
      await waitForBufferedFrames(candidate.resource, candidate.abortController.signal);
      const currentChannel = this.#connectedChannel();
      if (
        candidate.abortController.signal.aborted ||
        sequence !== this.#bitrateRequestSequence ||
        this.#bitrateCandidate !== candidate ||
        this.#opusPipeline !== owned ||
        !this.#isCurrentConnection(connection.generation, connection.connection) ||
        connection.connection.state.status !== VoiceConnectionStatus.Ready ||
        !currentChannel ||
        resolveDiscordOpusBitrate(this.#bitrateMode, currentChannel.bitrate) !== bitrate
      ) {
        throw new Error('The Discord audio state changed during bitrate warm-up.');
      }

      while (candidate.resource.playStream.readableLength > DISCORD_BITRATE_PRIME_FRAMES) {
        candidate.resource.playStream.read();
      }

      candidate.promote();
      this.#opusPipeline = candidate;
      const previousFillerFrames = this.#currentFillerFrames();
      try {
        this.player.play(candidate.resource);
      } catch (error) {
        this.#opusPipeline = owned;
        throw error;
      }
      this.#fillerFramesOffset += previousFillerFrames;
      try {
        owned.pipeline.releaseInput?.();
        candidate.pipeline.promoteInput?.();
      } catch (error) {
        void this.#queuePipelineStop(owned);
        throw error;
      }
      void this.#queuePipelineStop(owned);
      await this.#waitForPromotedPlayer(candidate);
      if (
        sequence !== this.#bitrateRequestSequence ||
        this.#opusPipeline !== candidate ||
        !this.#isCurrentConnection(connection.generation, connection.connection)
      )
        return;
      candidate.activate();
      if (this.#bitrateCandidate === candidate) this.#bitrateCandidate = null;
      this.#audioRetryAttempt = 0;
      this.#clearBitrateRetry();
      if (this.#error?.startsWith('Discord audio bitrate')) this.#error = null;
    } catch (error) {
      if (this.#bitrateCandidate === candidate) this.#bitrateCandidate = null;
      if (this.#opusPipeline !== candidate) {
        await this.#stopBitrateCandidate(candidate);
      } else {
        await this.#failPromotedBitratePipeline(
          candidate,
          `Discord audio bitrate: ${error instanceof Error ? error.message : 'replacement failed.'}`
        );
      }
      if (sequence !== this.#bitrateRequestSequence) return;
      throw error;
    }
  }

  async #createBitrateCandidate(
    connectionGeneration: number,
    bitrate: number
  ): Promise<CandidateAudioPipeline> {
    const generation = ++this.#pipelineGeneration;
    const abortController = new AbortController();
    let stage: 'warming' | 'promoting' | 'active' | 'stopping' = 'warming';
    const fail = (message: string) => {
      if (stage === 'warming' || stage === 'promoting') abortController.abort(new Error(message));
      else if (stage === 'active') this.#failAudioPipeline(generation, message);
    };
    const pipeline = this.#createAudioPipeline(
      this.#mixer,
      bitrate,
      {
        onError: (message) => fail(`Discord audio pipeline: ${message}`),
        onClose: (event) => {
          if (event.expected || stage === 'stopping') return;
          fail(
            event.message
              ? `Discord audio pipeline: ${event.message}`
              : 'Discord audio pipeline: Opus encoder exited unexpectedly.'
          );
        }
      },
      true
    );
    let resource: AudioResource;
    try {
      resource = createAudioResource(pipeline.stream, {
        inputType: pipeline.inputType
      });
    } catch (error) {
      stage = 'stopping';
      await this.#trackCandidateCleanup(Promise.resolve().then(() => pipeline.stop()));
      throw error;
    }
    let stopPromise: Promise<void> | null = null;

    return {
      generation,
      connectionGeneration,
      bitrate,
      pipeline,
      resource,
      abortController,
      promote() {
        stage = 'promoting';
      },
      activate() {
        stage = 'active';
      },
      stop() {
        if (!stopPromise) {
          stage = 'stopping';
          abortController.abort(new Error('The replacement Opus encoder was stopped.'));
          stopPromise = pipeline.stop();
        }
        return stopPromise;
      }
    };
  }

  async #waitForPromotedPlayer(candidate: CandidateAudioPipeline): Promise<void> {
    const signal = candidate.abortController.signal;
    if (signal.aborted) throw abortError(signal.reason);
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        if (error) reject(abortError(error));
        else resolve();
      };
      const onAbort = () => finish(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) {
        onAbort();
        return;
      }
      void entersState(this.player, AudioPlayerStatus.Playing, 5_000).then(
        () => finish(),
        (error) => finish(error)
      );
    });
  }

  async start(): Promise<void> {
    if (this.#shuttingDown || !this.#discordToken) return;
    this.#loginDesired = true;
    if (this.client.isReady() || this.#loginRetryTimer) return;
    if (this.#loginPromise) return this.#loginPromise;

    this.#loginPromise = this.#attemptLogin();
    return this.#loginPromise;
  }

  async #attemptLogin(): Promise<void> {
    try {
      await this.client.login(this.#discordToken);
      if (!this.#loginDesired || this.#shuttingDown) {
        this.client.destroy();
        return;
      }
      this.#clearLoginRetry();
      this.#loginRetryAttempt = 0;
      this.#error = null;
    } catch (error) {
      if (!this.#loginDesired || this.#shuttingDown) return;
      this.#error = error instanceof Error ? error.message : 'Discord login failed.';
      console.error(`Discord login failed: ${this.#error}`);
      this.#scheduleLoginRetry();
    } finally {
      this.#loginPromise = null;
    }
  }

  status(): DiscordStatus {
    const channel = this.#connectedChannel();
    const playerState = this.player.state;
    const audioPlayable =
      Boolean(this.#opusPipeline) && playerState.status === AudioPlayerStatus.Playing;
    const playerPlaybackMilliseconds =
      'playbackDuration' in playerState ? playerState.playbackDuration : 0;
    const resourcePlaybackMilliseconds =
      'resource' in playerState ? playerState.resource.playbackDuration : 0;
    return {
      configured: Boolean(this.#discordToken),
      ready: this.client.isReady(),
      botName: this.client.user?.username ?? null,
      botAvatarUrl: this.client.user?.displayAvatarURL({ size: 128 }) ?? null,
      connected:
        this.#connection?.connection.state.status === VoiceConnectionStatus.Ready &&
        Boolean(channel),
      guildId: channel?.guild.id ?? null,
      guildName: channel?.guild.name ?? null,
      channelId: channel?.id ?? null,
      channelName: channel?.name ?? null,
      playerState: playerState.status,
      playableConnections: audioPlayable ? this.player.playable.length : 0,
      subscribed:
        audioPlayable &&
        this.#connection?.connection.state.status !== VoiceConnectionStatus.Destroyed &&
        Boolean(this.#connection?.connection.state.subscription),
      audioDiagnostics: {
        encoder: 'ffmpeg/libopus',
        bitrateMode: this.#bitrateMode,
        bitrate: this.#opusPipeline?.bitrate ?? null,
        channelBitrate: channel?.bitrate ?? null,
        bitrateReconfiguring:
          this.#bitrateReconfiguring || Boolean(this.#bitrateCandidate || this.#bitrateRetryTimer),
        packetizationMilliseconds: DISCORD_OPUS_PAGE_MILLISECONDS,
        missedFrames: 'missedFrames' in playerState ? playerState.missedFrames : 0,
        fillerFrames: this.#fillerFramesOffset + this.#currentFillerFrames(),
        ...this.#mixer.diagnostics,
        playerPlaybackMilliseconds,
        resourcePlaybackMilliseconds
      },
      error: this.#error
    };
  }

  #currentFillerFrames(): number {
    const playerState = this.player.state;
    const playerPlaybackMilliseconds =
      'playbackDuration' in playerState ? playerState.playbackDuration : 0;
    const resourcePlaybackMilliseconds =
      'resource' in playerState ? playerState.resource.playbackDuration : 0;
    return Math.max(
      0,
      Math.round((playerPlaybackMilliseconds - resourcePlaybackMilliseconds) / 20)
    );
  }

  guilds(): GuildSummary[] {
    if (!this.client.isReady()) return [];
    return [...this.client.guilds.cache.values()]
      .map((guild) => ({
        id: guild.id,
        name: guild.name,
        iconUrl: guild.iconURL({ size: 64 }),
        voiceChannels: [...guild.channels.cache.values()]
          .filter(
            (channel): channel is VoiceBasedChannel => channel.type === ChannelType.GuildVoice
          )
          .sort((a, b) => a.rawPosition - b.rawPosition)
          .map((channel) => ({
            id: channel.id,
            guildId: guild.id,
            name: channel.name,
            position: channel.rawPosition,
            bitrate: channel.bitrate
          }))
      }))
      .filter((guild) => guild.voiceChannels.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async connect(channelId: string): Promise<DiscordStatus> {
    if (!this.client.isReady()) throw new Error('The Discord bot is not ready.');
    const requestSequence = ++this.#connectRequestSequence;
    const channel = await this.client.channels.fetch(channelId);
    if (requestSequence !== this.#connectRequestSequence)
      throw new Error('This voice connection request was superseded by a newer request.');
    if (!channel || channel.type !== ChannelType.GuildVoice) {
      throw new Error('Choose a Discord voice channel visible to the bot.');
    }

    const generation = ++this.#connectionGeneration;
    this.#connectionExpected = false;
    this.#clearAudioRetry();
    this.#clearBitrateRetry();
    this.#disposeConnection();
    await this.#disposeAudio();
    if (generation !== this.#connectionGeneration)
      throw new Error('This voice connection request was superseded by a newer request.');
    this.#fillerFramesOffset = 0;

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false
    });
    const ownedConnection = { generation, connection, guild: channel.guild, recovery: null };
    this.#connection = ownedConnection;
    this.#connectionExpected = true;
    this.#watchConnection(ownedConnection);

    let failureMessage = `Could not connect to #${channel.name}. Check the bot's Connect and Speak permissions.`;
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
      this.#assertCurrentConnection(generation, connection);
      // Starting the encoder before the socket is playable would buffer silence
      // produced during the Discord voice handshake.
      await this.#prepareAudio(generation);
      const subscription = connection.subscribe(this.player);
      if (!subscription) {
        failureMessage = 'Discord rejected the audio-player subscription.';
        throw new Error(failureMessage);
      }
      await entersState(this.player, AudioPlayerStatus.Playing, 5_000);
      this.#assertCurrentConnection(generation, connection);
      if (connection.state.status !== VoiceConnectionStatus.Ready) {
        failureMessage = `The connection to #${channel.name} stopped being ready during audio startup.`;
        throw new Error(failureMessage);
      }
      if (this.#opusPipeline?.connectionGeneration !== generation)
        throw new Error('The Discord audio pipeline changed during connection.');
      this.#audioRetryAttempt = 0;
      this.#error = null;
      return this.status();
    } catch (error) {
      const current =
        this.#connectionGeneration === generation && this.#connection?.connection === connection;
      if (connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
      if (!current) {
        if (this.#connection?.connection === connection) this.#connection = null;
        await this.#disposeAudioForConnection(generation);
        throw error;
      }
      this.#connectionExpected = false;
      this.#connection = null;
      this.#clearAudioRetry();
      this.#clearBitrateRetry();
      await this.#disposeAudioForConnection(generation);
      this.#error = failureMessage;
      throw new Error(this.#error);
    }
  }

  disconnect(): void {
    this.#connectRequestSequence += 1;
    this.#connectionGeneration += 1;
    this.#connectionExpected = false;
    this.#clearAudioRetry();
    this.#clearBitrateRetry();
    this.#disposeConnection();
    void this.#disposeAudio();
  }

  async shutdown(): Promise<void> {
    this.#shuttingDown = true;
    this.#loginDesired = false;
    this.#connectRequestSequence += 1;
    this.#connectionGeneration += 1;
    this.#connectionExpected = false;
    this.#clearLoginRetry();
    this.#clearAudioRetry();
    this.#clearBitrateRetry();
    const candidateCleanup = this.#cancelBitrateReconfigure(
      'The Discord service is shutting down.'
    );
    this.#disposeConnection();
    const pendingLogin = this.#loginPromise;
    const audioCleanup = this.#disposeAudio();
    const bitrateCleanup = this.#bitrateReconfigureBarrier.catch(() => undefined);
    const clientCleanup = Promise.resolve(this.client.destroy());
    await Promise.all([
      audioCleanup,
      bitrateCleanup,
      candidateCleanup,
      clientCleanup,
      pendingLogin ?? Promise.resolve()
    ]);
    await Promise.all([this.#pipelineStopBarrier, this.#candidateCleanupBarrier]);
  }

  #disposeConnection(): void {
    const owned = this.#connection;
    this.#connection = null;
    if (owned && owned.connection.state.status !== VoiceConnectionStatus.Destroyed)
      owned.connection.destroy();
  }

  async #disposeAudio(generation?: number): Promise<void> {
    const owned = this.#opusPipeline;
    if (generation !== undefined && owned?.generation !== generation) return;
    const candidateCleanup = this.#cancelBitrateReconfigure(
      'The active Discord audio pipeline changed.'
    );
    if (owned) this.#fillerFramesOffset += this.#currentFillerFrames();
    this.#opusPipeline = null;
    this.player.stop(true);
    const activeCleanup = owned ? this.#queuePipelineStop(owned) : this.#pipelineStopBarrier;
    await Promise.all([activeCleanup, candidateCleanup]);
    await this.#candidateCleanupBarrier;
  }

  #queuePipelineStop(owned: OwnedAudioPipeline): Promise<void> {
    const stopTask = this.#pipelineStopBarrier
      .then(() =>
        'stop' in owned && typeof owned.stop === 'function' ? owned.stop() : owned.pipeline.stop()
      )
      .catch((error) => {
        const message = error instanceof Error ? error.message : 'unknown encoder shutdown error';
        console.error(`Discord audio pipeline shutdown: ${message}`);
      });
    this.#pipelineStopBarrier = stopTask;
    return stopTask;
  }

  #trackCandidateCleanup(cleanup: Promise<void>): Promise<void> {
    const cleanupTask = cleanup.catch((error) => {
      const message = error instanceof Error ? error.message : 'unknown encoder shutdown error';
      console.error(`Discord bitrate candidate shutdown: ${message}`);
    });
    this.#candidateCleanupBarrier = Promise.all([this.#candidateCleanupBarrier, cleanupTask]).then(
      () => undefined
    );
    return cleanupTask;
  }

  #stopBitrateCandidate(candidate: CandidateAudioPipeline): Promise<void> {
    return this.#trackCandidateCleanup(Promise.resolve().then(() => candidate.stop()));
  }

  #cancelBitrateCandidate(message: string): Promise<void> {
    const candidate = this.#bitrateCandidate;
    if (!candidate) return this.#candidateCleanupBarrier;
    this.#bitrateCandidate = null;
    candidate.abortController.abort(new Error(message));
    return this.#stopBitrateCandidate(candidate);
  }

  #cancelBitrateReconfigure(message: string): Promise<void> {
    this.#bitrateRequestSequence += 1;
    this.#bitrateReconfiguring = false;
    this.#bitrateReconfigureError = null;
    return this.#cancelBitrateCandidate(message);
  }

  async #failPromotedBitratePipeline(
    candidate: CandidateAudioPipeline,
    message: string
  ): Promise<void> {
    if (this.#bitrateCandidate === candidate) this.#bitrateCandidate = null;
    if (this.#opusPipeline !== candidate) {
      await this.#stopBitrateCandidate(candidate);
      return;
    }
    this.#error = message;
    console.error(message);
    this.#clearBitrateRetry();
    const connectionGeneration = candidate.connectionGeneration;
    this.#fillerFramesOffset += this.#currentFillerFrames();
    this.#opusPipeline = null;
    this.player.stop(true);
    await this.#queuePipelineStop(candidate);
    this.#scheduleAudioRecovery(connectionGeneration);
  }

  async #disposeAudioForConnection(connectionGeneration: number): Promise<void> {
    if (this.#opusPipeline?.connectionGeneration !== connectionGeneration) return;
    await this.#disposeAudio(this.#opusPipeline.generation);
  }

  #connectedChannel(): VoiceBasedChannel | null {
    if (
      !this.#connection ||
      this.#connection.connection.state.status === VoiceConnectionStatus.Destroyed
    )
      return null;
    const channelId = this.#connection.connection.joinConfig.channelId;
    if (!channelId) return null;
    const channel = this.client.channels.cache.get(channelId);
    return channel?.type === ChannelType.GuildVoice ? channel : null;
  }

  #watchConnection(owned: OwnedConnection): void {
    const { connection, generation, guild } = owned;
    connection.on('error', (error) => {
      if (this.#connection?.connection !== connection) return;
      this.#error = `Voice connection: ${error.message}`;
      console.error(this.#error);
    });
    connection.on(VoiceConnectionStatus.Destroyed, () => {
      if (!this.#isOwnedConnection(generation, connection)) return;
      this.#connection = null;
      this.#connectionExpected = false;
      this.#clearAudioRetry();
      this.#clearBitrateRetry();
      void this.#disposeAudioForConnection(generation);
    });
    connection.on(VoiceConnectionStatus.Disconnected, () => {
      if (!this.#isOwnedConnection(generation, connection) || owned.recovery) return;
      owned.recovery = this.#recoverVoiceConnection(owned).finally(() => {
        owned.recovery = null;
      });
    });
  }

  async #recoverVoiceConnection(owned: OwnedConnection): Promise<void> {
    const { connection, generation, guild } = owned;
    try {
      await entersState(
        connection,
        VoiceConnectionStatus.Ready,
        DISCORD_VOICE_RECOVERY_MILLISECONDS
      );
      if (
        !this.#isCurrentConnection(generation, connection) ||
        connection.state.status !== VoiceConnectionStatus.Ready
      )
        throw new Error('The voice connection did not return to Ready.');
    } catch {
      if (!this.#isOwnedConnection(generation, connection)) return;
      this.#error = `Disconnected from ${guild.name}; reconnect from the dashboard.`;
      this.#connection = null;
      this.#connectionExpected = false;
      this.#clearAudioRetry();
      this.#clearBitrateRetry();
      if (connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
      await this.#disposeAudioForConnection(generation);
    }
  }

  #assertCurrentConnection(generation: number, connection: VoiceConnection): void {
    if (!this.#isCurrentConnection(generation, connection))
      throw new Error('This voice connection request was superseded by a newer request.');
  }

  #isCurrentConnection(generation: number, connection: VoiceConnection): boolean {
    return (
      this.#connectionGeneration === generation && this.#isOwnedConnection(generation, connection)
    );
  }

  #isOwnedConnection(generation: number, connection: VoiceConnection): boolean {
    return (
      this.#connection?.generation === generation && this.#connection.connection === connection
    );
  }

  #isConnectionExpected(generation: number): boolean {
    return (
      !this.#shuttingDown &&
      this.#connectionExpected &&
      this.#connectionGeneration === generation &&
      this.#connection?.generation === generation &&
      this.#connection.connection.state.status !== VoiceConnectionStatus.Destroyed
    );
  }

  #failAudioPipeline(generation: number, message: string): void {
    const owned = this.#opusPipeline;
    if (!owned || owned.generation !== generation) return;
    this.#error = message;
    console.error(message);
    this.#clearBitrateRetry();
    const connectionGeneration = owned.connectionGeneration;
    void this.#disposeAudio(generation).then(() => {
      this.#scheduleAudioRecovery(connectionGeneration);
    });
  }

  #scheduleAudioRecovery(connectionGeneration: number): void {
    if (this.#audioRetryTimer || !this.#isConnectionExpected(connectionGeneration)) return;
    const delay = retryDelay(
      this.#audioRetryAttempt,
      DISCORD_AUDIO_RETRY_BASE_MILLISECONDS,
      DISCORD_AUDIO_RETRY_MAX_MILLISECONDS
    );
    this.#audioRetryAttempt += 1;
    this.#audioRetryTimer = setTimeout(() => {
      this.#audioRetryTimer = null;
      void this.#recoverAudio(connectionGeneration);
    }, delay);
    this.#audioRetryTimer.unref();
  }

  async #recoverAudio(connectionGeneration: number): Promise<void> {
    if (!this.#isConnectionExpected(connectionGeneration)) return;
    const connection = this.#connection?.connection;
    if (!connection || connection.state.status !== VoiceConnectionStatus.Ready) {
      this.#scheduleAudioRecovery(connectionGeneration);
      return;
    }

    let pipelineGeneration: number | null = null;
    try {
      pipelineGeneration = await this.#prepareAudio(connectionGeneration);
      const subscription = connection.subscribe(this.player);
      if (!subscription) throw new Error('Discord rejected the audio-player subscription.');
      await entersState(this.player, AudioPlayerStatus.Playing, 5_000);
      if (
        !this.#isCurrentConnection(connectionGeneration, connection) ||
        this.#opusPipeline?.generation !== pipelineGeneration
      )
        return;
      this.#audioRetryAttempt = 0;
      this.#clearBitrateRetry();
      if (this.#error?.startsWith('Discord audio')) this.#error = null;
    } catch (error) {
      if (!this.#isConnectionExpected(connectionGeneration)) return;
      if (pipelineGeneration !== null) await this.#disposeAudio(pipelineGeneration);
      this.#error =
        error instanceof Error
          ? `Discord audio recovery: ${error.message}`
          : 'Discord audio recovery failed.';
      console.error(this.#error);
      this.#scheduleAudioRecovery(connectionGeneration);
    }
  }

  #scheduleLoginRetry(): void {
    if (this.#loginRetryTimer || !this.#loginDesired || this.#shuttingDown) return;
    const delay = retryDelay(
      this.#loginRetryAttempt,
      DISCORD_LOGIN_RETRY_BASE_MILLISECONDS,
      DISCORD_LOGIN_RETRY_MAX_MILLISECONDS
    );
    this.#loginRetryAttempt += 1;
    this.#loginRetryTimer = setTimeout(() => {
      this.#loginRetryTimer = null;
      if (!this.#loginDesired || this.#shuttingDown || this.client.isReady()) return;
      this.#loginPromise = this.#attemptLogin();
    }, delay);
    this.#loginRetryTimer.unref();
  }

  #needsBitrateReconfigure(): boolean {
    const owned = this.#opusPipeline;
    const connection = this.#connection;
    const channel = this.#connectedChannel();
    if (
      !owned ||
      !connection ||
      !channel ||
      !this.#isConnectionExpected(connection.generation) ||
      connection.generation !== owned.connectionGeneration ||
      connection.connection.state.status !== VoiceConnectionStatus.Ready
    )
      return false;
    return owned.bitrate !== resolveDiscordOpusBitrate(this.#bitrateMode, channel.bitrate);
  }

  #scheduleBitrateRetry(): void {
    if (this.#bitrateRetryTimer || this.#shuttingDown || !this.#needsBitrateReconfigure()) return;
    const delay = retryDelay(
      this.#bitrateRetryAttempt,
      DISCORD_BITRATE_RETRY_BASE_MILLISECONDS,
      DISCORD_BITRATE_RETRY_MAX_MILLISECONDS
    );
    this.#bitrateRetryAttempt += 1;
    this.#bitrateRetryTimer = setTimeout(() => {
      this.#bitrateRetryTimer = null;
      if (this.#shuttingDown || !this.#needsBitrateReconfigure()) {
        this.#clearBitrateRetry();
        return;
      }
      const { completion } = this.#requestBitrateReconfigure();
      void completion.then(
        () => this.#clearBitrateRetry(),
        (error) => {
          this.#error =
            error instanceof Error
              ? `Discord audio bitrate: ${error.message}`
              : 'Discord audio bitrate change failed.';
          console.error(this.#error);
          this.#scheduleBitrateRetry();
        }
      );
    }, delay);
    this.#bitrateRetryTimer.unref();
  }

  #clearBitrateRetry(): void {
    if (this.#bitrateRetryTimer) clearTimeout(this.#bitrateRetryTimer);
    this.#bitrateRetryTimer = null;
    this.#bitrateRetryAttempt = 0;
  }

  #clearAudioRetry(): void {
    if (this.#audioRetryTimer) clearTimeout(this.#audioRetryTimer);
    this.#audioRetryTimer = null;
    this.#audioRetryAttempt = 0;
  }

  #clearLoginRetry(): void {
    if (this.#loginRetryTimer) clearTimeout(this.#loginRetryTimer);
    this.#loginRetryTimer = null;
  }
}
