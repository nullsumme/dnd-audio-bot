import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DiscordBitrateMode } from '$lib/audio-quality';
import { ApplicationSettingsStore } from './settings';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true }))
  );
});

async function fixture(defaultMode: DiscordBitrateMode = 'auto') {
  const directory = await mkdtemp(join(tmpdir(), 'soundkeep-settings-'));
  directories.push(directory);
  const settings = new ApplicationSettingsStore(directory, defaultMode);
  return { directory, settings };
}

describe('ApplicationSettingsStore', () => {
  it('creates defaults and persists all supported modes across reloads', async () => {
    const { directory, settings } = await fixture();
    await settings.initialize();
    expect(settings.discordBitrateMode).toBe('auto');

    for (const mode of ['64000', '96000', '128000', '384000', 'auto'] as const) {
      await settings.setDiscordBitrateMode(mode);
      const reloaded = new ApplicationSettingsStore(directory, '64000');
      await reloaded.initialize();
      expect(reloaded.discordBitrateMode).toBe(mode);
    }
  });

  it('cleans abandoned temporary files during initialization', async () => {
    const { directory, settings } = await fixture();
    await writeFile(join(directory, '.settings-abandoned.tmp'), 'partial');
    await writeFile(join(directory, 'settings.json.abandoned.tmp'), 'partial');

    await settings.initialize();

    expect(await readdir(directory)).toEqual(['settings.json']);
  });

  it('does not publish a mode when atomic persistence fails', async () => {
    const { settings } = await fixture();
    await settings.initialize();
    await rm(settings.path);
    await mkdir(settings.path);

    await expect(settings.setDiscordBitrateMode('384000')).rejects.toThrow();
    expect(settings.discordBitrateMode).toBe('auto');
  });

  it('rejects malformed or unsupported persisted settings', async () => {
    const { settings } = await fixture();
    await writeFile(settings.path, JSON.stringify({ version: 1, discordBitrateMode: '192000' }));
    await expect(settings.initialize()).rejects.toThrow('Unsupported application settings');

    await writeFile(settings.path, '{');
    await expect(settings.initialize()).rejects.toThrow();
  });

  it('serializes concurrent mutations and leaves the last requested mode on disk', async () => {
    const { settings } = await fixture();
    await settings.initialize();

    await Promise.all([
      settings.setDiscordBitrateMode('64000'),
      settings.setDiscordBitrateMode('96000'),
      settings.setDiscordBitrateMode('128000'),
      settings.setDiscordBitrateMode('384000')
    ]);

    expect(settings.discordBitrateMode).toBe('384000');
    const persisted = JSON.parse(await readFile(settings.path, 'utf8')) as {
      discordBitrateMode: string;
    };
    expect(persisted.discordBitrateMode).toBe('384000');
  });
});
