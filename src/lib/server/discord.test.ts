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
        bufferMilliseconds: 200,
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
});
