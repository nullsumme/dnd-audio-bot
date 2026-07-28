import {
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  type VoiceConnection
} from '@discordjs/voice';
import {
  ChannelType,
  Client,
  GatewayIntentBits,
  type Guild,
  type VoiceBasedChannel
} from 'discord.js';
import type { DiscordStatus, GuildSummary } from '$lib/types';
import { config } from './config';
import {
  DISCORD_OPUS_BITRATE,
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

interface DiscordAudioPipeline extends DiscordOpusPipeline {
  inputType: StreamType;
}

type AudioPipelineFactory = (
  mixer: PcmMixer,
  lifecycle: DiscordOpusEncoderLifecycle
) => DiscordAudioPipeline;

const createDefaultAudioPipeline: AudioPipelineFactory = (mixer, lifecycle) => ({
  ...spawnDiscordOpusEncoder(mixer, lifecycle),
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
  pipeline: DiscordAudioPipeline;
}

function retryDelay(attempt: number, base: number, maximum: number): number {
  return Math.min(maximum, base * 2 ** Math.min(attempt, 20));
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
    discordToken = config.discordToken
  ) {
    this.#mixer = mixer;
    this.#createAudioPipeline = createAudioPipeline;
    this.#discordToken = discordToken;
    this.player.on('error', (error) => {
      const owned = this.#opusPipeline;
      if (!owned) return;
      this.#failAudioPipeline(owned.generation, `Discord audio player: ${error.message}`);
    });
    this.player.on(AudioPlayerStatus.Idle, () => {
      const owned = this.#opusPipeline;
      if (!owned || !this.#isConnectionExpected(owned.connectionGeneration)) return;
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
  }

  async prepareAudio(): Promise<void> {
    await this.#prepareAudio(this.#connection?.generation ?? this.#connectionGeneration);
  }

  async #prepareAudio(connectionGeneration: number): Promise<number> {
    await this.#pipelineStopBarrier;
    if (!this.#isConnectionExpected(connectionGeneration))
      throw new Error('The Discord voice connection is no longer available.');
    if (this.#connection?.connection.state.status !== VoiceConnectionStatus.Ready)
      throw new Error('The Discord voice connection is not ready.');
    if (this.#opusPipeline) return this.#opusPipeline.generation;
    const generation = ++this.#pipelineGeneration;
    const pipeline = this.#createAudioPipeline(this.#mixer, {
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
    });
    this.#opusPipeline = { generation, connectionGeneration, pipeline };
    const resource = createAudioResource(pipeline.stream, {
      inputType: pipeline.inputType
    });
    this.player.play(resource);
    return generation;
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
        bitrate: DISCORD_OPUS_BITRATE,
        packetizationMilliseconds: DISCORD_OPUS_PAGE_MILLISECONDS,
        missedFrames: 'missedFrames' in playerState ? playerState.missedFrames : 0,
        fillerFrames: Math.max(
          0,
          Math.round((playerPlaybackMilliseconds - resourcePlaybackMilliseconds) / 20)
        ),
        ...this.#mixer.diagnostics,
        playerPlaybackMilliseconds,
        resourcePlaybackMilliseconds
      },
      error: this.#error
    };
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
            position: channel.rawPosition
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
    this.#disposeConnection();
    await this.#disposeAudio();
    if (generation !== this.#connectionGeneration)
      throw new Error('This voice connection request was superseded by a newer request.');

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
    this.#disposeConnection();
    const pendingLogin = this.#loginPromise;
    const audioCleanup = this.#disposeAudio();
    const clientCleanup = Promise.resolve(this.client.destroy());
    await Promise.all([audioCleanup, clientCleanup, pendingLogin ?? Promise.resolve()]);
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
    this.#opusPipeline = null;
    this.player.stop(true);
    if (!owned) {
      await this.#pipelineStopBarrier;
      return;
    }
    const stopTask = this.#pipelineStopBarrier
      .then(() => owned.pipeline.stop())
      .catch((error) => {
        const message = error instanceof Error ? error.message : 'unknown encoder shutdown error';
        console.error(`Discord audio pipeline shutdown: ${message}`);
      });
    this.#pipelineStopBarrier = stopTask;
    await stopTask;
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
