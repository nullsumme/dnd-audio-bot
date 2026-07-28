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
  type DiscordOpusPipeline
} from './audio/encoder';
import type { PcmMixer } from './audio/mixer';

interface DiscordAudioPipeline extends DiscordOpusPipeline {
  inputType: StreamType;
}

type AudioPipelineFactory = (
  mixer: PcmMixer,
  onError: (message: string) => void
) => DiscordAudioPipeline;

const createDefaultAudioPipeline: AudioPipelineFactory = (mixer, onError) => ({
  ...spawnDiscordOpusEncoder(mixer, onError),
  inputType: StreamType.OggOpus
});

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
  #connection: VoiceConnection | null = null;
  #opusPipeline: DiscordOpusPipeline | null = null;
  #error: string | null = null;
  #started = false;

  constructor(mixer: PcmMixer, createAudioPipeline = createDefaultAudioPipeline) {
    this.#mixer = mixer;
    this.#createAudioPipeline = createAudioPipeline;
    this.player.on('error', (error) => {
      this.#error = `Discord audio player: ${error.message}`;
      console.error(this.#error);
    });
    this.player.on(AudioPlayerStatus.Playing, () => {
      if (this.#error?.startsWith('Discord audio player:')) this.#error = null;
    });
    this.client.on('error', (error) => {
      this.#error = `Discord client: ${error.message}`;
      console.error(this.#error);
    });
  }

  prepareAudio(): void {
    if (this.#opusPipeline) return;
    const pipeline = this.#createAudioPipeline(this.#mixer, (message) => {
      this.#error = message;
      console.error(message);
    });
    this.#opusPipeline = pipeline;
    const resource = createAudioResource(pipeline.stream, {
      inputType: pipeline.inputType
    });
    this.player.play(resource);
  }

  async start(): Promise<void> {
    if (this.#started || !config.discordToken) return;
    this.#started = true;
    try {
      await this.client.login(config.discordToken);
      this.#error = null;
    } catch (error) {
      this.#started = false;
      this.#error = error instanceof Error ? error.message : 'Discord login failed.';
      console.error(`Discord login failed: ${this.#error}`);
    }
  }

  status(): DiscordStatus {
    const channel = this.#connectedChannel();
    const playerState = this.player.state;
    const playerPlaybackMilliseconds =
      'playbackDuration' in playerState ? playerState.playbackDuration : 0;
    const resourcePlaybackMilliseconds =
      'resource' in playerState ? playerState.resource.playbackDuration : 0;
    return {
      configured: Boolean(config.discordToken),
      ready: this.client.isReady(),
      botName: this.client.user?.username ?? null,
      botAvatarUrl: this.client.user?.displayAvatarURL({ size: 128 }) ?? null,
      connected: this.#connection?.state.status === VoiceConnectionStatus.Ready && Boolean(channel),
      guildId: channel?.guild.id ?? null,
      guildName: channel?.guild.name ?? null,
      channelId: channel?.id ?? null,
      channelName: channel?.name ?? null,
      playerState: playerState.status,
      playableConnections: this.player.playable.length,
      subscribed:
        this.#connection?.state.status !== VoiceConnectionStatus.Destroyed &&
        Boolean(this.#connection?.state.subscription),
      audioDiagnostics: {
        encoder: 'ffmpeg/libopus',
        bitrate: DISCORD_OPUS_BITRATE,
        packetizationMilliseconds: DISCORD_OPUS_PAGE_MILLISECONDS,
        missedFrames: 'missedFrames' in playerState ? playerState.missedFrames : 0,
        fillerFrames: Math.max(
          0,
          Math.round((playerPlaybackMilliseconds - resourcePlaybackMilliseconds) / 20)
        ),
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
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || channel.type !== ChannelType.GuildVoice) {
      throw new Error('Choose a Discord voice channel visible to the bot.');
    }

    this.disconnect();
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false
    });
    this.#connection = connection;
    this.#watchConnection(connection, channel.guild);

    let failureMessage = `Could not connect to #${channel.name}. Check the bot's Connect and Speak permissions.`;
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
      // Starting the encoder before the socket is playable would buffer silence
      // produced during the Discord voice handshake.
      this.prepareAudio();
      const subscription = connection.subscribe(this.player);
      if (!subscription) {
        failureMessage = 'Discord rejected the audio-player subscription.';
        throw new Error(failureMessage);
      }
      await entersState(this.player, AudioPlayerStatus.Playing, 5_000);
      this.#error = null;
      return this.status();
    } catch {
      connection.destroy();
      if (this.#connection === connection) this.#connection = null;
      this.#disposeAudio();
      this.#error = failureMessage;
      throw new Error(this.#error);
    }
  }

  disconnect(): void {
    const connection = this.#connection;
    this.#connection = null;
    if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed)
      connection.destroy();
    this.#disposeAudio();
  }

  async shutdown(): Promise<void> {
    this.disconnect();
    this.client.destroy();
  }

  #disposeAudio(): void {
    this.player.stop(true);
    this.#opusPipeline?.stop();
    this.#opusPipeline = null;
  }

  #connectedChannel(): VoiceBasedChannel | null {
    if (!this.#connection || this.#connection.state.status === VoiceConnectionStatus.Destroyed)
      return null;
    const channelId = this.#connection.joinConfig.channelId;
    if (!channelId) return null;
    const channel = this.client.channels.cache.get(channelId);
    return channel?.type === ChannelType.GuildVoice ? channel : null;
  }

  #watchConnection(connection: VoiceConnection, guild: Guild): void {
    connection.on('error', (error) => {
      this.#error = `Voice connection: ${error.message}`;
      console.error(this.#error);
    });
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000)
        ]);
      } catch {
        if (this.#connection !== connection) return;
        this.#error = `Disconnected from ${guild.name}; reconnect from the dashboard.`;
        connection.destroy();
        this.#connection = null;
        this.#disposeAudio();
      }
    });
  }
}
