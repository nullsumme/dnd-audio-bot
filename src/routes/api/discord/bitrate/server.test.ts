import { describe, expect, it } from 'vitest';
import { _formatDiscordBitrateMode, _parseDiscordBitrateMode } from './+server';

describe('Discord bitrate requests', () => {
  it('accepts exactly Auto and the four supported presets', () => {
    for (const mode of ['auto', '64000', '96000', '128000', '384000']) {
      expect(_parseDiscordBitrateMode({ mode })).toBe(mode);
    }
  });

  it('rejects unsupported, numeric and missing modes', () => {
    for (const body of [
      { mode: '65000' },
      { mode: 96_000 },
      { mode: null },
      {},
      { mode: 'AUTO' }
    ]) {
      expect(() => _parseDiscordBitrateMode(body)).toThrow();
    }
  });

  it('formats persisted bps modes as human-readable kbps activity', () => {
    expect(_formatDiscordBitrateMode('auto')).toBe('automatic');
    expect(_formatDiscordBitrateMode('384000')).toBe('384 kbps');
  });
});
