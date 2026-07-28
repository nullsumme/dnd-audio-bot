import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { isDiscordBitrateMode, type DiscordBitrateMode } from '$lib/audio-quality';
import { config } from './config';

const SETTINGS_VERSION = 1;
const SETTINGS_TEMP_PREFIX = '.settings-';

interface StoredSettings {
  version: number;
  discordBitrateMode: unknown;
}

class AsyncLock {
  #tail: Promise<void> = Promise.resolve();

  async run<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#tail;
    let release: () => void = () => {};
    this.#tail = new Promise<void>((resolveLock) => {
      release = resolveLock;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

async function syncDirectory(path: string): Promise<void> {
  const directory = await open(path, fsConstants.O_RDONLY);
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

export class ApplicationSettingsStore {
  readonly path: string;
  #discordBitrateMode: DiscordBitrateMode;
  #mutationLock = new AsyncLock();

  constructor(
    readonly dataDir = config.dataDir,
    defaultBitrateMode = config.discordOpusBitrateMode
  ) {
    this.path = join(dataDir, 'settings.json');
    this.#discordBitrateMode = defaultBitrateMode;
  }

  get discordBitrateMode(): DiscordBitrateMode {
    return this.#discordBitrateMode;
  }

  async initialize(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    await this.#removeTemps();
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as StoredSettings;
      if (parsed.version !== SETTINGS_VERSION || !isDiscordBitrateMode(parsed.discordBitrateMode)) {
        throw new Error('Unsupported application settings.');
      }
      this.#discordBitrateMode = parsed.discordBitrateMode;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await this.#write(this.#discordBitrateMode);
    }
  }

  async setDiscordBitrateMode(mode: DiscordBitrateMode): Promise<void> {
    await this.#mutationLock.run(async () => {
      if (mode === this.#discordBitrateMode) return;
      await this.#write(mode);
      this.#discordBitrateMode = mode;
    });
  }

  async #removeTemps(): Promise<void> {
    for (const entry of await readdir(this.dataDir, { withFileTypes: true })) {
      const isCurrent = entry.name.startsWith(SETTINGS_TEMP_PREFIX);
      const isLegacy =
        entry.name.startsWith(`${basename(this.path)}.`) && entry.name.endsWith('.tmp');
      if (!isCurrent && !isLegacy) continue;
      await rm(join(this.dataDir, entry.name), {
        force: true,
        recursive: entry.isDirectory()
      });
    }
  }

  async #write(mode: DiscordBitrateMode): Promise<void> {
    const temporaryPath = join(
      this.dataDir,
      `${SETTINGS_TEMP_PREFIX}${process.pid}-${randomUUID()}.tmp`
    );
    const file = await open(
      temporaryPath,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
      0o640
    );
    try {
      const settings = {
        version: SETTINGS_VERSION,
        discordBitrateMode: mode
      };
      await file.writeFile(`${JSON.stringify(settings, null, 2)}\n`, 'utf8');
      await file.sync();
    } catch (error) {
      await file.close().catch(() => undefined);
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
    await file.close();
    try {
      await rename(temporaryPath, this.path);
      await syncDirectory(this.dataDir);
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }
}
