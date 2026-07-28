import { describe, expect, it } from 'vitest';
import { DISCORD_OPUS_ARGS, DISCORD_OPUS_BITRATE, DISCORD_OPUS_PAGE_MILLISECONDS } from './encoder';

describe('Discord Opus encoder settings', () => {
  it('emits and flushes one low-delay Opus packet per Discord frame', () => {
    expect(DISCORD_OPUS_BITRATE).toBe(64_000);
    expect(DISCORD_OPUS_PAGE_MILLISECONDS).toBe(20);
    expect(DISCORD_OPUS_ARGS).toEqual(
      expect.arrayContaining([
        '-b:a',
        '64000',
        '-vbr',
        'constrained',
        '-application',
        'lowdelay',
        '-frame_duration',
        '20',
        '-page_duration',
        '20000',
        '-flush_packets',
        '1'
      ])
    );
  });
});
