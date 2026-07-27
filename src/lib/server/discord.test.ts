import { afterEach, describe, expect, it } from 'vitest';
import { StreamType } from '@discordjs/voice';
import { PcmMixer } from './audio/mixer';
import { DiscordService } from './discord';

describe('DiscordService audio player', () => {
  let mixer: PcmMixer | null = null;
  let service: DiscordService | null = null;

  afterEach(async () => {
    await service?.shutdown();
    mixer?.destroy();
    service = null;
    mixer = null;
  });

  it('keeps the perpetual mixer paused until a voice connection can receive it', async () => {
    mixer = new PcmMixer();
    service = new DiscordService(mixer, (input) => ({
      stream: input,
      inputType: StreamType.Raw,
      stop() {}
    }));
    service.prepareAudio();

    await expect.poll(() => service?.status().playerState, { timeout: 3_000 }).toBe('autopaused');
    expect(service.status()).toMatchObject({
      playerState: 'autopaused',
      playableConnections: 0,
      subscribed: false,
      audioDiagnostics: {
        encoder: 'ffmpeg/libopus',
        bitrate: 64_000,
        bufferMilliseconds: 200,
        missedFrames: 0
      }
    });
  });
});
