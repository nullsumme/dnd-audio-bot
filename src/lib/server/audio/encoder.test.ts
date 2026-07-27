import { describe, expect, it } from 'vitest';
import {
  DISCORD_OPUS_ARGS,
  DISCORD_OPUS_BITRATE,
  DISCORD_OPUS_BUFFER_MILLISECONDS
} from './encoder';

describe('Discord Opus encoder settings', () => {
  it('stays within the default channel bitrate and buffers ten 20 ms frames', () => {
    expect(DISCORD_OPUS_BITRATE).toBe(64_000);
    expect(DISCORD_OPUS_BUFFER_MILLISECONDS).toBe(200);
    expect(DISCORD_OPUS_ARGS).toEqual(
      expect.arrayContaining(['-b:a', '64000', '-vbr', 'constrained', '-page_duration', '200000'])
    );
  });
});
