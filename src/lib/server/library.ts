import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { promisify } from 'node:util';
import type { AssetRole, AudioAsset } from '$lib/types';
import { config } from './config';

const execFileAsync = promisify(execFile);
const INDEX_VERSION = 3;

interface LibraryIndex {
  version: number;
  assets: unknown[];
}

function isMp3(bytes: Uint8Array): boolean {
  if (bytes.length < 3) return false;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true;
  return bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
}

function cleanText(value: string, fallback: string, maxLength: number): string {
  const cleaned = value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
  return cleaned || fallback;
}

export class AudioLibrary {
  readonly audioDir: string;
  readonly indexPath: string;
  #assets = new Map<string, AudioAsset>();
  #writeChain: Promise<void> = Promise.resolve();

  constructor(readonly dataDir = config.dataDir) {
    this.audioDir = join(dataDir, 'audio');
    this.indexPath = join(dataDir, 'library.json');
  }

  async initialize(): Promise<void> {
    await mkdir(this.audioDir, { recursive: true });
    try {
      const raw = await readFile(this.indexPath, 'utf8');
      const parsed = JSON.parse(raw) as LibraryIndex;
      if (![1, 2, INDEX_VERSION].includes(parsed.version) || !Array.isArray(parsed.assets)) {
        throw new Error('Unsupported library index version.');
      }
      const migrated = parsed.assets.map((asset) => this.#migrateAsset(asset, parsed.version));
      const assets = migrated.filter((asset): asset is AudioAsset => asset !== null);
      this.#assets = new Map(assets.map((asset) => [asset.id, asset]));
      if (parsed.version !== INDEX_VERSION || assets.length !== parsed.assets.length) {
        await this.#persist();
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw error;
      await this.#persist();
    }
  }

  list(): AudioAsset[] {
    return [...this.#assets.values()].sort((a, b) => {
      if (a.role !== b.role) return a.role.localeCompare(b.role);
      if (a.category !== b.category) return a.category.localeCompare(b.category);
      return a.name.localeCompare(b.name);
    });
  }

  get(id: string): AudioAsset | null {
    return this.#assets.get(id) ?? null;
  }

  filePath(asset: AudioAsset): string {
    return join(this.audioDir, asset.filename);
  }

  async add(input: {
    bytes: Uint8Array;
    originalFilename: string;
    name: string;
    category: string;
    role: AssetRole;
  }): Promise<AudioAsset> {
    if (input.bytes.byteLength === 0) throw new Error('The uploaded file is empty.');
    if (input.bytes.byteLength > config.maxUploadBytes) {
      throw new Error(
        `The upload exceeds the ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB limit.`
      );
    }
    if (extname(input.originalFilename).toLowerCase() !== '.mp3' || !isMp3(input.bytes)) {
      throw new Error('Only valid MP3 files are accepted.');
    }

    const id = randomUUID();
    const filename = `${id}.mp3`;
    const target = join(this.audioDir, filename);
    await writeFile(target, input.bytes, { flag: 'wx', mode: 0o640 });

    const now = new Date().toISOString();
    const asset: AudioAsset = {
      id,
      name: cleanText(input.name, basename(input.originalFilename, '.mp3'), 100),
      category: cleanText(input.category, input.role === 'soundboard' ? 'Effects' : 'Ambience', 40),
      role: input.role,
      filename,
      originalFilename: basename(input.originalFilename).slice(0, 180),
      mimeType: 'audio/mpeg',
      size: input.bytes.byteLength,
      duration: await this.#probeDuration(target),
      createdAt: now,
      updatedAt: now
    };

    this.#assets.set(id, asset);
    try {
      await this.#persist();
      return asset;
    } catch (error) {
      this.#assets.delete(id);
      await rm(target, { force: true });
      throw error;
    }
  }

  async update(
    id: string,
    input: Partial<Pick<AudioAsset, 'name' | 'category' | 'role'>>
  ): Promise<AudioAsset> {
    const current = this.#assets.get(id);
    if (!current) throw new Error('Audio asset not found.');
    const updated: AudioAsset = {
      ...current,
      name: input.name === undefined ? current.name : cleanText(input.name, current.name, 100),
      category:
        input.category === undefined
          ? current.category
          : cleanText(input.category, current.category, 40),
      role: input.role ?? current.role,
      updatedAt: new Date().toISOString()
    };
    this.#assets.set(id, updated);
    await this.#persist();
    return updated;
  }

  async delete(id: string): Promise<AudioAsset> {
    const asset = this.#assets.get(id);
    if (!asset) throw new Error('Audio asset not found.');
    const originalPath = this.filePath(asset);
    const deletingPath = `${originalPath}.deleting`;
    await rename(originalPath, deletingPath);
    this.#assets.delete(id);
    try {
      await this.#persist();
      await rm(deletingPath, { force: true });
      return asset;
    } catch (error) {
      this.#assets.set(id, asset);
      await rename(deletingPath, originalPath).catch(() => undefined);
      throw error;
    }
  }

  #migrateAsset(value: unknown, version: number): AudioAsset | null {
    if (!value || typeof value !== 'object') throw new Error('Invalid audio library entry.');
    const record = value as Record<string, unknown>;
    const role = record.role === 'ambience' ? 'ambience' : 'soundboard';
    if (typeof record.id !== 'string' || typeof record.name !== 'string') {
      throw new Error('Invalid audio library entry.');
    }

    const filename = typeof record.filename === 'string' ? record.filename : null;
    if (version === 2 && !filename) return null;
    if (!filename) throw new Error('An audio library entry is missing its MP3 file.');

    return {
      id: record.id,
      name: record.name,
      category: typeof record.category === 'string' ? record.category : 'Uncategorized',
      role,
      filename,
      originalFilename:
        typeof record.originalFilename === 'string' ? record.originalFilename : basename(filename),
      mimeType: 'audio/mpeg',
      size: typeof record.size === 'number' && record.size >= 0 ? record.size : 0,
      duration:
        typeof record.duration === 'number' && record.duration >= 0 ? record.duration : null,
      createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString(),
      updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date().toISOString()
    };
  }

  async #probeDuration(path: string): Promise<number | null> {
    try {
      const { stdout } = await execFileAsync(
        config.ffprobePath,
        [
          '-v',
          'error',
          '-show_entries',
          'format=duration',
          '-of',
          'default=noprint_wrappers=1:nokey=1',
          path
        ],
        { timeout: 15_000, maxBuffer: 1024 * 1024 }
      );
      const duration = Number.parseFloat(stdout.trim());
      return Number.isFinite(duration) && duration >= 0 ? duration : null;
    } catch {
      return null;
    }
  }

  #persist(): Promise<void> {
    this.#writeChain = this.#writeChain
      .catch(() => undefined)
      .then(async () => {
        const temporaryPath = `${this.indexPath}.${process.pid}.tmp`;
        const index: LibraryIndex = { version: INDEX_VERSION, assets: this.list() };
        await writeFile(temporaryPath, `${JSON.stringify(index, null, 2)}\n`, {
          encoding: 'utf8',
          mode: 0o640
        });
        await rename(temporaryPath, this.indexPath);
      });
    return this.#writeChain;
  }
}
