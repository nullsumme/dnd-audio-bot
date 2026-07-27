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
import type { PcmMixer } from './audio/mixer';

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
  #connection: VoiceConnection | null = null;
  #error: string | null = null;
  #started = false;

  constructor(mixer: PcmMixer) {
    const resource = createAudioResource(mixer, { inputType: StreamType.Raw });
    this.player.play(resource);
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
      playerState: this.player.state.status,
      playableConnections: this.player.playable.length,
      subscribed:
        this.#connection?.state.status !== VoiceConnectionStatus.Destroyed &&
        Boolean(this.#connection?.state.subscription),
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
    const subscription = connection.subscribe(this.player);
    if (!subscription) {
      connection.destroy();
      this.#connection = null;
      throw new Error('Discord rejected the audio-player subscription.');
    }
    this.#watchConnection(connection, channel.guild);

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
      await entersState(this.player, AudioPlayerStatus.Playing, 5_000);
      this.#error = null;
      return this.status();
    } catch {
      connection.destroy();
      if (this.#connection === connection) this.#connection = null;
      this.#error = `Could not connect to #${channel.name}. Check the bot's Connect and Speak permissions.`;
      throw new Error(this.#error);
    }
  }

  disconnect(): void {
    const connection = this.#connection;
    this.#connection = null;
    if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed)
      connection.destroy();
  }

  async shutdown(): Promise<void> {
    this.disconnect();
    this.player.stop();
    this.client.destroy();
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
      }
    });
  }
}
