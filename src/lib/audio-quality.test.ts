import { describe, expect, it } from 'vitest';
import { isDiscordBitrateMode, resolveDiscordOpusBitrate } from './audio-quality';

describe('Discord audio quality', () => {
  it('recognizes only supported UI bitrate modes', () => {
    for (const mode of ['auto', '64000', '96000', '128000']) {
      expect(isDiscordBitrateMode(mode)).toBe(true);
    }
    for (const mode of ['32000', '128001', 96_000, null]) {
      expect(isDiscordBitrateMode(mode)).toBe(false);
    }
  });

  it('caps Auto and fixed modes to the connected channel', () => {
    expect(resolveDiscordOpusBitrate('auto', 64_000)).toBe(64_000);
    expect(resolveDiscordOpusBitrate('auto', 96_000)).toBe(96_000);
    expect(resolveDiscordOpusBitrate('auto', 256_000)).toBe(128_000);
    expect(resolveDiscordOpusBitrate('64000', 128_000)).toBe(64_000);
    expect(resolveDiscordOpusBitrate('128000', 96_000)).toBe(96_000);
  });

  it('refuses an invalid channel bitrate instead of guessing a cap', () => {
    expect(() => resolveDiscordOpusBitrate('auto', 0)).toThrow(
      'Discord did not report a valid bitrate'
    );
    expect(() => resolveDiscordOpusBitrate('auto', 7_999)).toThrow();
  });
});
