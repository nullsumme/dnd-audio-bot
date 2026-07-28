import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AudioPlayerStatus,
  StreamType,
  VoiceConnectionStatus,
  type VoiceConnection
} from '@discordjs/voice';
import { ChannelType, type VoiceBasedChannel } from 'discord.js';
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
  DISCORD_LOGIN_RETRY_BASE_MILLISECONDS,
  DISCORD_VOICE_RECOVERY_MILLISECONDS,
  DiscordService
} from './discord';

interface FakePipeline {
  lifecycle: DiscordOpusEncoderLifecycle;
  stop: ReturnType<typeof vi.fn<() => Promise<void>>>;
}

function channel(id: string, name: string): VoiceBasedChannel {
  return {
    id,
    name,
    type: ChannelType.GuildVoice,
    guild: {
      id: `guild-${id}`,
      name: `Guild ${name}`,
      voiceAdapterCreator: {}
    }
  } as unknown as VoiceBasedChannel;
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

  function createService(token = ''): DiscordService {
    mixer = new PcmMixer();
    pipelines = [];
    service = new DiscordService(
      mixer,
      (_input, lifecycle) => {
        const fake = { lifecycle, stop: vi.fn<() => Promise<void>>(async () => {}) };
        pipelines.push(fake);
        return {
          stream: new PassThrough(),
          inputType: StreamType.Opus,
          stop: fake.stop
        };
      },
      token
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
    const { connection, voiceChannel } = arrangeReadyConnection();
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
      (_input, lifecycle) => {
        events.push('prepare encoder');
        pipelines.push({
          lifecycle,
          stop: vi.fn<() => Promise<void>>(async () => {})
        });
        return {
          stream: new PassThrough(),
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
