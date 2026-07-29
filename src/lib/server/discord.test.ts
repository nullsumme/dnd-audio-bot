import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AudioPlayerStatus,
  StreamType,
  VoiceConnectionStatus,
  type VoiceConnection
} from '@discordjs/voice';
import { ChannelType, Events, type VoiceBasedChannel } from 'discord.js';
import type { DiscordBitrateMode } from '$lib/audio-quality';
import type { DiscordOpusEncoderLifecycle } from './audio/encoder';

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
import {
  DISCORD_AUDIO_RETRY_BASE_MILLISECONDS,
  DISCORD_BITRATE_RETRY_BASE_MILLISECONDS,
  DISCORD_LOGIN_RETRY_BASE_MILLISECONDS,
  DISCORD_VOICE_RECOVERY_MILLISECONDS,
  DiscordService
} from './discord';

interface FakePipeline {
  bitrate: number;
  lifecycle: DiscordOpusEncoderLifecycle;
  stream: PassThrough;
  stop: ReturnType<typeof vi.fn<() => Promise<void>>>;
}

interface FakeVoiceGuildCaches {
  voiceStates: {
    cache: Map<string, { id: string; channelId: string | null }>;
  };
  members: {
    cache: Map<string, { id: string; user: { bot: boolean } }>;
  };
}

function channel(id: string, name: string, bitrate = 96_000): VoiceBasedChannel {
  return {
    id,
    name,
    bitrate,
    rawPosition: 0,
    type: ChannelType.GuildVoice,
    guild: {
      id: `guild-${id}`,
      name: `Guild ${name}`,
      voiceAdapterCreator: {},
      voiceStates: { cache: new Map() },
      members: { cache: new Map() }
    }
  } as unknown as VoiceBasedChannel;
}

function cacheVoiceMember(
  voiceChannel: VoiceBasedChannel,
  memberId: string,
  bot: boolean,
  channelId: string | null = voiceChannel.id
): void {
  const guild = voiceChannel.guild as unknown as FakeVoiceGuildCaches;
  guild.voiceStates.cache.set(memberId, { id: memberId, channelId });
  guild.members.cache.set(memberId, { id: memberId, user: { bot } });
}

function voiceConnection(voiceChannel: VoiceBasedChannel): VoiceConnection {
  const emitter = new EventEmitter() as EventEmitter & VoiceConnection;
  Object.assign(emitter, {
    state: { status: VoiceConnectionStatus.Ready, subscription: {} },
    joinConfig: { channelId: voiceChannel.id },
    subscribe: vi.fn(() => ({})),
    destroy: vi.fn(function (this: VoiceConnection) {
      Object.assign(this, { state: { status: VoiceConnectionStatus.Destroyed } });
    })
  });
  return emitter;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('DiscordService audio lifecycle', () => {
  let mixer: PcmMixer | null = null;
  let service: DiscordService | null = null;
  let pipelines: FakePipeline[] = [];

  function createService(token = '', bitrateMode: DiscordBitrateMode = 'auto'): DiscordService {
    mixer = new PcmMixer();
    pipelines = [];
    service = new DiscordService(
      mixer,
      (_input, bitrate, lifecycle) => {
        const fake = {
          bitrate,
          lifecycle,
          stream: new PassThrough({ objectMode: true }),
          stop: vi.fn<() => Promise<void>>(async () => {})
        };
        pipelines.push(fake);
        return {
          stream: fake.stream,
          inputType: StreamType.Opus,
          stop: fake.stop
        };
      },
      token,
      bitrateMode
    );
    return service;
  }

  function arrangeReadyConnection(voiceChannel = channel('123456789', 'Table')) {
    const connection = voiceConnection(voiceChannel);
    vi.spyOn(service!.client, 'isReady').mockReturnValue(true);
    vi.spyOn(service!.client.channels, 'fetch').mockResolvedValue(voiceChannel);
    service!.client.channels.cache.set(voiceChannel.id, voiceChannel);
    voiceMocks.joinVoiceChannel.mockReturnValue(connection);
    voiceMocks.entersState.mockResolvedValue(undefined);
    return { connection, voiceChannel };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await service?.shutdown();
    mixer?.destroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
    service = null;
    mixer = null;
    pipelines = [];
  });

  it('waits for a playable voice socket before starting and subscribing the encoder', async () => {
    const events: string[] = [];
    createService();
    const { connection, voiceChannel } = arrangeReadyConnection(
      channel('123456789', 'Table', 384_000)
    );
    voiceMocks.entersState.mockImplementation(async (target: unknown) => {
      events.push(target === connection ? 'voice ready' : 'player ready');
      return target;
    });
    vi.mocked(connection.subscribe).mockImplementation(() => {
      events.push('subscribe player');
      return {} as never;
    });
    service = new DiscordService(
      mixer!,
      (_input, bitrate, lifecycle) => {
        events.push('prepare encoder');
        const pipeline = {
          bitrate,
          lifecycle,
          stream: new PassThrough({ objectMode: true }),
          stop: vi.fn<() => Promise<void>>(async () => {})
        };
        pipelines.push(pipeline);
        return {
          stream: pipeline.stream,
          inputType: StreamType.Opus,
          stop: pipelines.at(-1)!.stop
        };
      },
      ''
    );
    vi.spyOn(service.client, 'isReady').mockReturnValue(true);
    vi.spyOn(service.client.channels, 'fetch').mockResolvedValue(voiceChannel);
    service.client.channels.cache.set(voiceChannel.id, voiceChannel);

    await service.connect(voiceChannel.id);

    expect(events).toEqual(['voice ready', 'prepare encoder', 'subscribe player', 'player ready']);
    expect(pipelines[0].bitrate).toBe(384_000);
    expect(service.status().audioDiagnostics).toMatchObject({
      bitrateMode: 'auto',
      bitrate: 384_000,
      channelBitrate: 384_000
    });
  });

  it('counts cached human listeners in the connected channel independently of audio playback', async () => {
    createService();
    const voiceChannel = channel('123456789', 'Table');
    const guild = voiceChannel.guild as unknown as FakeVoiceGuildCaches;
    cacheVoiceMember(voiceChannel, 'human-one', false);
    cacheVoiceMember(voiceChannel, 'human-two', false);
    cacheVoiceMember(voiceChannel, 'other-channel', false, '987654321');
    cacheVoiceMember(voiceChannel, 'another-bot', true);
    cacheVoiceMember(voiceChannel, 'soundkeep', false);
    guild.voiceStates.cache.set('uncached-member', {
      id: 'uncached-member',
      channelId: voiceChannel.id
    });
    service!.client.user = {
      id: 'soundkeep',
      username: 'Soundkeep',
      displayAvatarURL: vi.fn(() => null)
    } as never;
    arrangeReadyConnection(voiceChannel);

    await service!.connect(voiceChannel.id);

    expect(service!.status()).toMatchObject({
      listenerCount: 2,
      playableConnections: 0
    });

    guild.voiceStates.cache.get('human-two')!.channelId = '987654321';
    cacheVoiceMember(voiceChannel, 'human-three', false);
    expect(service!.status()).toMatchObject({
      listenerCount: 2,
      playableConnections: 0
    });

    service!.disconnect();
    expect(service!.status().listenerCount).toBe(0);
  });

  it('warms and swaps a capped bitrate without reconnecting or resubscribing', async () => {
    createService('', '64000');
    const { connection, voiceChannel } = arrangeReadyConnection(
      channel('123456789', 'Table', 96_000)
    );
    await service!.connect(voiceChannel.id);
    expect(pipelines[0].bitrate).toBe(64_000);

    let finished = false;
    const changing = service!.setBitrateMode('auto').then(() => {
      finished = true;
    });
    await vi.waitFor(() => expect(pipelines).toHaveLength(2));
    expect(pipelines[1].bitrate).toBe(96_000);
    pipelines[1].stream.write(Buffer.from([1]));
    pipelines[1].stream.write(Buffer.from([2]));
    await Promise.resolve();
    expect(finished).toBe(false);
    expect(pipelines[0].stop).not.toHaveBeenCalled();

    pipelines[1].stream.write(Buffer.from([3]));
    await changing;

    expect(voiceMocks.joinVoiceChannel).toHaveBeenCalledOnce();
    expect(connection.subscribe).toHaveBeenCalledOnce();
    expect(pipelines[0].stop).toHaveBeenCalledOnce();
    expect(service!.status().audioDiagnostics).toMatchObject({
      bitrateMode: 'auto',
      bitrate: 96_000,
      channelBitrate: 96_000,
      bitrateReconfiguring: false
    });
  });

  it('keeps the active encoder and rolls back the mode when candidate warm-up fails', async () => {
    createService('', '64000');
    const { voiceChannel } = arrangeReadyConnection(channel('123456789', 'Table', 128_000));
    await service!.connect(voiceChannel.id);

    const changing = service!.setBitrateMode('128000');
    await vi.waitFor(() => expect(pipelines).toHaveLength(2));
    pipelines[1].lifecycle.onError('candidate failed');

    await expect(changing).rejects.toThrow('candidate failed');
    expect(pipelines[0].stop).not.toHaveBeenCalled();
    expect(pipelines[1].stop).toHaveBeenCalledOnce();
    expect(service!.status().audioDiagnostics).toMatchObject({
      bitrateMode: '64000',
      bitrate: 64_000
    });
  });

  it('rejects and recovers when Discord does not accept a promoted encoder', async () => {
    vi.useFakeTimers();
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    createService('', '64000');
    const { voiceChannel } = arrangeReadyConnection(channel('123456789', 'Table', 128_000));
    await service!.connect(voiceChannel.id);
    voiceMocks.entersState.mockRejectedValueOnce(new Error('player promotion failed'));

    const changing = service!.setBitrateMode('128000');
    await vi.advanceTimersByTimeAsync(0);
    expect(pipelines).toHaveLength(2);
    pipelines[1].stream.write(Buffer.from([1]));
    pipelines[1].stream.write(Buffer.from([2]));
    pipelines[1].stream.write(Buffer.from([3]));

    await expect(changing).rejects.toThrow('player promotion failed');

    expect(pipelines[0].stop).toHaveBeenCalledOnce();
    expect(pipelines[1].stop).toHaveBeenCalledOnce();
    expect(service!.status().audioDiagnostics).toMatchObject({
      bitrateMode: '64000',
      bitrate: null,
      bitrateReconfiguring: false
    });
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('player promotion failed'));
  });

  it('waits for a warming candidate to stop exactly once before reconnecting after disconnect', async () => {
    createService('', '64000');
    const { voiceChannel } = arrangeReadyConnection(channel('123456789', 'First table', 128_000));
    await service!.connect(voiceChannel.id);

    const changing = service!.setBitrateMode('128000');
    await vi.waitFor(() => expect(pipelines).toHaveLength(2));
    const candidateStopped = deferred<void>();
    pipelines[1].stop.mockImplementation(() => candidateStopped.promise);

    service!.disconnect();
    await vi.waitFor(() => expect(pipelines[1].stop).toHaveBeenCalledOnce());

    const nextChannel = channel('987654321', 'Second table', 96_000);
    const nextConnection = voiceConnection(nextChannel);
    vi.mocked(service!.client.channels.fetch).mockResolvedValue(nextChannel);
    service!.client.channels.cache.set(nextChannel.id, nextChannel);
    voiceMocks.joinVoiceChannel.mockReturnValue(nextConnection);
    let reconnectFinished = false;
    const reconnecting = service!.connect(nextChannel.id).then(() => {
      reconnectFinished = true;
    });

    await Promise.resolve();
    expect(voiceMocks.joinVoiceChannel).toHaveBeenCalledOnce();
    expect(reconnectFinished).toBe(false);

    candidateStopped.resolve();
    await Promise.all([changing, reconnecting]);

    expect(voiceMocks.joinVoiceChannel).toHaveBeenCalledTimes(2);
    expect(pipelines[1].stop).toHaveBeenCalledOnce();
    expect(reconnectFinished).toBe(true);
  });

  it('waits for a warming candidate to stop exactly once during shutdown', async () => {
    createService('', '64000');
    const { voiceChannel } = arrangeReadyConnection(channel('123456789', 'Table', 128_000));
    await service!.connect(voiceChannel.id);

    const changing = service!.setBitrateMode('128000');
    await vi.waitFor(() => expect(pipelines).toHaveLength(2));
    const candidateStopped = deferred<void>();
    pipelines[1].stop.mockImplementation(() => candidateStopped.promise);
    let shutdownFinished = false;

    const shutdown = service!.shutdown().then(() => {
      shutdownFinished = true;
    });
    await vi.waitFor(() => expect(pipelines[1].stop).toHaveBeenCalledOnce());
    expect(shutdownFinished).toBe(false);

    candidateStopped.resolve();
    await Promise.all([changing, shutdown]);

    expect(pipelines[1].stop).toHaveBeenCalledOnce();
    expect(shutdownFinished).toBe(true);
  });

  it('retries a failed automatic channel bitrate swap and converges', async () => {
    vi.useFakeTimers();
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    createService();
    const { voiceChannel } = arrangeReadyConnection(channel('123456789', 'Table', 128_000));
    await service!.connect(voiceChannel.id);
    expect(pipelines[0].bitrate).toBe(128_000);

    const updatedChannel = channel(voiceChannel.id, voiceChannel.name, 64_000);
    service!.client.channels.cache.set(updatedChannel.id, updatedChannel);
    service!.client.emit(Events.ChannelUpdate, voiceChannel, updatedChannel);
    await vi.advanceTimersByTimeAsync(0);
    expect(pipelines).toHaveLength(2);
    expect(pipelines[1].bitrate).toBe(64_000);

    pipelines[1].lifecycle.onError('candidate failed');
    await vi.advanceTimersByTimeAsync(0);
    expect(pipelines[1].stop).toHaveBeenCalledOnce();
    expect(service!.status().audioDiagnostics).toMatchObject({
      bitrate: 128_000,
      channelBitrate: 64_000,
      bitrateReconfiguring: true
    });

    await vi.advanceTimersByTimeAsync(DISCORD_BITRATE_RETRY_BASE_MILLISECONDS);
    expect(pipelines).toHaveLength(3);
    expect(pipelines[2].bitrate).toBe(64_000);

    pipelines[2].stream.write(Buffer.from([1]));
    pipelines[2].stream.write(Buffer.from([2]));
    pipelines[2].stream.write(Buffer.from([3]));
    await vi.advanceTimersByTimeAsync(0);

    expect(pipelines[0].stop).toHaveBeenCalledOnce();
    expect(pipelines[1].stop).toHaveBeenCalledOnce();
    expect(pipelines[2].stop).not.toHaveBeenCalled();
    expect(service!.status().audioDiagnostics).toMatchObject({
      bitrateMode: 'auto',
      bitrate: 64_000,
      channelBitrate: 64_000,
      bitrateReconfiguring: false
    });
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('candidate failed'));
  });

  it('converges on the latest channel cap when it changes during a manual warm-up', async () => {
    createService('', '64000');
    const { voiceChannel } = arrangeReadyConnection(channel('123456789', 'Table', 128_000));
    await service!.connect(voiceChannel.id);

    const changing = service!.setBitrateMode('128000');
    await vi.waitFor(() => expect(pipelines).toHaveLength(2));
    expect(pipelines[1].bitrate).toBe(128_000);

    const updatedChannel = channel(voiceChannel.id, voiceChannel.name, 96_000);
    service!.client.channels.cache.set(updatedChannel.id, updatedChannel);
    service!.client.emit(Events.ChannelUpdate, voiceChannel, updatedChannel);

    await vi.waitFor(() => expect(pipelines).toHaveLength(3));
    expect(pipelines[1].stop).toHaveBeenCalledOnce();
    expect(pipelines[2].bitrate).toBe(96_000);
    pipelines[2].stream.write(Buffer.from([1]));
    pipelines[2].stream.write(Buffer.from([2]));
    pipelines[2].stream.write(Buffer.from([3]));

    await changing;

    expect(pipelines[0].stop).toHaveBeenCalledOnce();
    expect(pipelines[1].stop).toHaveBeenCalledOnce();
    expect(pipelines[2].stop).not.toHaveBeenCalled();
    expect(service!.status().audioDiagnostics).toMatchObject({
      bitrateMode: '128000',
      bitrate: 96_000,
      channelBitrate: 96_000,
      bitrateReconfiguring: false
    });
  });

  it('updates the selected mode without rebuilding when the channel cap keeps the rate equal', async () => {
    createService();
    const { voiceChannel } = arrangeReadyConnection(channel('123456789', 'Table', 96_000));
    await service!.connect(voiceChannel.id);

    await service!.setBitrateMode('128000');

    expect(pipelines).toHaveLength(1);
    expect(service!.status().audioDiagnostics).toMatchObject({
      bitrateMode: '128000',
      bitrate: 96_000,
      channelBitrate: 96_000
    });
  });

  it('recovers a clean encoder exit once and ignores stale lifecycle callbacks', async () => {
    vi.useFakeTimers();
    createService();
    const { connection, voiceChannel } = arrangeReadyConnection();
    await service!.connect(voiceChannel.id);
    expect(pipelines).toHaveLength(1);

    pipelines[0].lifecycle.onClose({
      code: 0,
      signal: null,
      expected: false,
      message: null
    });
    await Promise.resolve();
    expect(pipelines[0].stop).toHaveBeenCalledOnce();
    expect(service!.status()).toMatchObject({
      connected: true,
      playableConnections: 0,
      subscribed: false
    });

    await vi.advanceTimersByTimeAsync(DISCORD_AUDIO_RETRY_BASE_MILLISECONDS);
    expect(pipelines).toHaveLength(2);
    expect(connection.subscribe).toHaveBeenCalledTimes(2);

    pipelines[0].lifecycle.onError('stale encoder error');
    pipelines[0].lifecycle.onClose({
      code: 1,
      signal: null,
      expected: false,
      message: 'stale encoder exit'
    });
    await vi.advanceTimersByTimeAsync(DISCORD_AUDIO_RETRY_BASE_MILLISECONDS * 2);
    expect(pipelines).toHaveLength(2);
    expect(pipelines[1].stop).not.toHaveBeenCalled();
  });

  it('rebuilds the current resource after an AudioPlayer error', async () => {
    vi.useFakeTimers();
    createService();
    const { voiceChannel } = arrangeReadyConnection();
    await service!.connect(voiceChannel.id);

    service!.player.emit('error', new Error('resource failed') as never);
    await vi.advanceTimersByTimeAsync(DISCORD_AUDIO_RETRY_BASE_MILLISECONDS);

    expect(pipelines).toHaveLength(2);
    expect(pipelines[0].stop).toHaveBeenCalledOnce();
  });

  it('does not let a stale failed connect tear down a newer pipeline', async () => {
    createService();
    const firstChannel = channel('111', 'First');
    const secondChannel = channel('222', 'Second');
    const firstConnection = voiceConnection(firstChannel);
    const secondConnection = voiceConnection(secondChannel);
    const firstReady = deferred<unknown>();

    vi.spyOn(service!.client, 'isReady').mockReturnValue(true);
    vi.spyOn(service!.client.channels, 'fetch').mockImplementation(async (id) =>
      id === firstChannel.id ? firstChannel : secondChannel
    );
    service!.client.channels.cache.set(firstChannel.id, firstChannel);
    service!.client.channels.cache.set(secondChannel.id, secondChannel);
    voiceMocks.joinVoiceChannel
      .mockReturnValueOnce(firstConnection)
      .mockReturnValueOnce(secondConnection);
    voiceMocks.entersState.mockImplementation(async (target: unknown, status: unknown) => {
      if (target === firstConnection && status === VoiceConnectionStatus.Ready)
        return firstReady.promise;
      return target;
    });

    const staleResult = service!.connect(firstChannel.id).catch((error) => error);
    await vi.waitFor(() => expect(voiceMocks.joinVoiceChannel).toHaveBeenCalledTimes(1));
    await service!.connect(secondChannel.id);
    expect(pipelines).toHaveLength(1);

    firstReady.reject(new Error('first connection failed late'));
    await expect(staleResult).resolves.toBeInstanceOf(Error);

    expect(pipelines).toHaveLength(1);
    expect(pipelines[0].stop).not.toHaveBeenCalled();
    expect(service!.status()).toMatchObject({
      connected: true,
      channelId: secondChannel.id
    });
  });

  it('retries a transient initial login failure without duplicate timers', async () => {
    vi.useFakeTimers();
    createService('test-token');
    let ready = false;
    vi.spyOn(service!.client, 'isReady').mockImplementation(() => ready);
    const login = vi
      .spyOn(service!.client, 'login')
      .mockRejectedValueOnce(new Error('gateway unavailable'))
      .mockImplementationOnce(async () => {
        ready = true;
        return 'test-token';
      });

    await service!.start();
    await service!.start();
    expect(login).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(DISCORD_LOGIN_RETRY_BASE_MILLISECONDS);
    expect(login).toHaveBeenCalledTimes(2);
    expect(service!.status().ready).toBe(true);
  });

  it('cancels pending recovery during clean shutdown', async () => {
    vi.useFakeTimers();
    createService();
    const { voiceChannel } = arrangeReadyConnection();
    await service!.connect(voiceChannel.id);
    pipelines[0].lifecycle.onError('encoder unavailable');

    await service!.shutdown();
    await vi.advanceTimersByTimeAsync(DISCORD_AUDIO_RETRY_BASE_MILLISECONDS * 4);

    expect(pipelines).toHaveLength(1);
  });

  it('keeps a healthy connection and its recovery ownership when replacement lookup fails', async () => {
    vi.useFakeTimers();
    createService();
    const { connection, voiceChannel } = arrangeReadyConnection();
    await service!.connect(voiceChannel.id);

    vi.mocked(service!.client.channels.fetch).mockRejectedValueOnce(new Error('lookup failed'));
    await expect(service!.connect('999')).rejects.toThrow('lookup failed');
    expect(service!.status()).toMatchObject({
      connected: true,
      channelId: voiceChannel.id
    });
    expect(connection.destroy).not.toHaveBeenCalled();

    pipelines[0].lifecycle.onError('encoder failed after lookup');
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(DISCORD_AUDIO_RETRY_BASE_MILLISECONDS);

    expect(pipelines).toHaveLength(2);
    expect(connection.subscribe).toHaveBeenCalledTimes(2);
  });

  it('cleans up only the matching connection after external destruction', async () => {
    createService();
    const { connection, voiceChannel } = arrangeReadyConnection();
    await service!.connect(voiceChannel.id);

    Object.assign(connection, { state: { status: VoiceConnectionStatus.Destroyed } });
    (connection as unknown as EventEmitter).emit(VoiceConnectionStatus.Destroyed);
    await vi.waitFor(() => expect(pipelines[0].stop).toHaveBeenCalledOnce());

    expect(service!.status()).toMatchObject({
      connected: false,
      channelId: null,
      subscribed: false,
      playableConnections: 0
    });
  });

  it('tears down a disconnected connection that never returns to Ready', async () => {
    createService();
    const { connection, voiceChannel } = arrangeReadyConnection();
    await service!.connect(voiceChannel.id);
    voiceMocks.entersState.mockRejectedValueOnce(new Error('voice recovery timed out'));

    Object.assign(connection, { state: { status: VoiceConnectionStatus.Disconnected } });
    (connection as unknown as EventEmitter).emit(VoiceConnectionStatus.Disconnected);
    await vi.waitFor(() => expect(connection.destroy).toHaveBeenCalledOnce());

    expect(voiceMocks.entersState).toHaveBeenLastCalledWith(
      connection,
      VoiceConnectionStatus.Ready,
      DISCORD_VOICE_RECOVERY_MILLISECONDS
    );
    expect(pipelines[0].stop).toHaveBeenCalledOnce();
    expect(service!.status().connected).toBe(false);
  });

  it('rejects connect success when voice readiness is lost during player startup', async () => {
    createService();
    const { connection, voiceChannel } = arrangeReadyConnection();
    voiceMocks.entersState.mockImplementation(async (target: unknown) => {
      if (target !== connection)
        Object.assign(connection, { state: { status: VoiceConnectionStatus.Connecting } });
      return target;
    });

    await expect(service!.connect(voiceChannel.id)).rejects.toThrow(
      'stopped being ready during audio startup'
    );
    expect(connection.destroy).toHaveBeenCalledOnce();
    expect(pipelines[0].stop).toHaveBeenCalledOnce();
    expect(service!.status().connected).toBe(false);
  });

  it('waits for a resistant encoder to close before creating its replacement', async () => {
    vi.useFakeTimers();
    createService();
    const { voiceChannel } = arrangeReadyConnection();
    await service!.connect(voiceChannel.id);
    const stopped = deferred<void>();
    pipelines[0].stop.mockImplementation(() => stopped.promise);

    pipelines[0].lifecycle.onError('encoder stalled');
    await Promise.resolve();
    expect(pipelines[0].stop).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(DISCORD_AUDIO_RETRY_BASE_MILLISECONDS * 4);
    expect(pipelines).toHaveLength(1);

    stopped.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(DISCORD_AUDIO_RETRY_BASE_MILLISECONDS);
    expect(pipelines).toHaveLength(2);
  });

  it('waits for delayed encoder close during shutdown', async () => {
    createService();
    const { voiceChannel } = arrangeReadyConnection();
    await service!.connect(voiceChannel.id);
    const stopped = deferred<void>();
    pipelines[0].stop.mockImplementation(() => stopped.promise);
    let shutdownFinished = false;

    const shutdown = service!.shutdown().then(() => {
      shutdownFinished = true;
    });
    await Promise.resolve();
    expect(pipelines[0].stop).toHaveBeenCalledOnce();
    expect(shutdownFinished).toBe(false);

    stopped.resolve();
    await shutdown;
    expect(shutdownFinished).toBe(true);
  });
});
