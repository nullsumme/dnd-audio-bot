import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StreamType, VoiceConnectionStatus, type VoiceConnection } from '@discordjs/voice';
import { ChannelType, type VoiceBasedChannel } from 'discord.js';

const voiceMocks = vi.hoisted(() => ({
  entersState: vi.fn(),
  joinVoiceChannel: vi.fn()
}));

vi.mock('@discordjs/voice', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@discordjs/voice')>();
  return {
    ...actual,
    entersState: voiceMocks.entersState,
    joinVoiceChannel: voiceMocks.joinVoiceChannel
  };
});

import { PcmMixer } from './audio/mixer';
import { DiscordService } from './discord';

describe('DiscordService audio player', () => {
  let mixer: PcmMixer | null = null;
  let service: DiscordService | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await service?.shutdown();
    mixer?.destroy();
    vi.restoreAllMocks();
    service = null;
    mixer = null;
  });

  it('discards an unconsumed audio pipeline before preparing a fresh connection', async () => {
    let pipelinesCreated = 0;
    let pipelinesStopped = 0;
    mixer = new PcmMixer();
    service = new DiscordService(mixer, (input) => {
      pipelinesCreated += 1;
      return {
        stream: input,
        inputType: StreamType.Raw,
        stop() {
          pipelinesStopped += 1;
        }
      };
    });
    service.prepareAudio();

    await expect.poll(() => service?.status().playerState, { timeout: 3_000 }).toBe('autopaused');
    expect(service.status()).toMatchObject({
      playerState: 'autopaused',
      playableConnections: 0,
      subscribed: false,
      audioDiagnostics: {
        encoder: 'ffmpeg/libopus',
        bitrate: 64_000,
        packetizationMilliseconds: 20,
        missedFrames: 0
      }
    });

    service.disconnect();
    expect(pipelinesStopped).toBe(1);
    expect(service.status().playerState).toBe('idle');

    service.prepareAudio();
    expect(pipelinesCreated).toBe(2);
    service.disconnect();
    expect(pipelinesStopped).toBe(2);
  });

  it('waits for a playable voice socket before starting the encoder', async () => {
    const events: string[] = [];
    mixer = new PcmMixer();
    service = new DiscordService(mixer, (input) => {
      events.push('prepare encoder');
      return {
        stream: input,
        inputType: StreamType.Raw,
        stop() {}
      };
    });

    const channel = {
      id: '123456789',
      name: 'Table',
      type: ChannelType.GuildVoice,
      guild: {
        id: '987654321',
        name: 'Campaign',
        voiceAdapterCreator: {}
      }
    } as unknown as VoiceBasedChannel;
    const connection = {
      state: { status: VoiceConnectionStatus.Ready, subscription: {} },
      joinConfig: { channelId: channel.id },
      subscribe: vi.fn(() => {
        events.push('subscribe player');
        return {};
      }),
      on: vi.fn(),
      destroy: vi.fn()
    } as unknown as VoiceConnection;

    vi.spyOn(service.client, 'isReady').mockReturnValue(true);
    vi.spyOn(service.client.channels, 'fetch').mockResolvedValue(channel);
    service.client.channels.cache.set(channel.id, channel);
    voiceMocks.joinVoiceChannel.mockReturnValue(connection);
    voiceMocks.entersState.mockImplementation(async (target: unknown) => {
      events.push(target === connection ? 'voice ready' : 'player ready');
      return target;
    });

    await service.connect(channel.id);

    expect(events).toEqual(['voice ready', 'prepare encoder', 'subscribe player', 'player ready']);
  });
});
