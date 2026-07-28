import { execFile } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  statfs,
  type FileHandle
} from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { ASSET_ICONS, type AssetIcon, type ArtworkMimeType } from '$lib/asset-metadata';
import type { AssetRole, AudioAsset } from '$lib/types';
import { config } from './config';

const execFileAsync = promisify(execFile);
const INDEX_VERSION = 4;
const INDEX_TEMP_PREFIX = '.library-index-';
const UPLOAD_TEMP_PREFIX = '.upload-';
const ARTWORK_TEMP_PREFIX = '.artwork-';
export const MAX_ARTWORK_BYTES = 5 * 1024 * 1024;

interface LibraryIndex {
  version: number;
  assets: unknown[];
}

interface Mp3Inspection {
  duration: number | null;
}

interface UploadReservation {
  budget: number;
  remaining: number;
}

interface ArtworkReservation {
  quotaBudget: number;
  diskBudget: number;
}

export interface AudioLibraryOptions {
  maxUploadBytes?: number;
  maxLibraryBytes?: number;
  minFreeBytes?: number;
  maxConcurrentUploads?: number;
  maxArtworkBytes?: number;
  ffmpegPath?: string;
  ffprobePath?: string;
}

export interface AddAudioInput {
  stream: ReadableStream<Uint8Array>;
  contentLength?: number;
  originalFilename: string;
  name: string;
  category: string;
  role: AssetRole;
  subtitle?: string;
  mood?: string;
  icon?: AssetIcon;
}

export class UploadBusyError extends Error {}
export class UploadLimitError extends Error {}
export class LibraryQuotaError extends Error {}

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

function cleanText(value: string, fallback: string, maxLength: number): string {
  const cleaned = value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
  return cleaned || fallback;
}

function cleanOptionalText(value: string | undefined, maxLength: number): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function cleanOriginalFilename(value: string): string {
  return basename(value.replaceAll('\\', '/'))
    .replace(/[\u0000-\u001f\u007f]/g, '_')
    .slice(0, 180);
}

function isManagedFilename(filename: string): boolean {
  if (!filename || filename.length > 220 || filename.includes('\0')) return false;
  if (basename(filename) !== filename || extname(filename).toLowerCase() !== '.mp3') return false;
  return filename !== '.' && filename !== '..';
}

function isManagedArtworkFilename(filename: string): boolean {
  if (!filename || filename.length > 220 || filename.includes('\0')) return false;
  if (basename(filename) !== filename) return false;
  return ['.jpg', '.jpeg', '.png'].includes(extname(filename).toLowerCase());
}

function isNodeError(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === code;
}

async function syncDirectory(path: string): Promise<void> {
  const directory = await open(path, fsConstants.O_RDONLY);
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

export class AudioLibrary {
  readonly audioDir: string;
  readonly artworkDir: string;
  readonly indexPath: string;
  readonly maxUploadBytes: number;
  readonly maxLibraryBytes: number;
  readonly minFreeBytes: number;
  readonly maxConcurrentUploads: number;
  readonly maxArtworkBytes: number;
  readonly ffmpegPath: string;
  readonly ffprobePath: string;

  #assets = new Map<string, AudioAsset>();
  #mutationLock = new AsyncLock();
  #quotaLock = new AsyncLock();
  #deletingAssets = new Set<string>();
  #activeUploads = 0;
  #uploadBudgets = 0;
  #remainingDiskReservations = 0;

  constructor(
    readonly dataDir = config.dataDir,
    options: AudioLibraryOptions = {}
  ) {
    this.audioDir = join(dataDir, 'audio');
    this.artworkDir = join(dataDir, 'artwork');
    this.indexPath = join(dataDir, 'library.json');
    this.maxUploadBytes = options.maxUploadBytes ?? config.maxUploadBytes;
    this.maxLibraryBytes = options.maxLibraryBytes ?? config.maxLibraryBytes;
    this.minFreeBytes = options.minFreeBytes ?? config.minFreeBytes;
    this.maxConcurrentUploads = options.maxConcurrentUploads ?? config.maxConcurrentUploads;
    this.maxArtworkBytes = options.maxArtworkBytes ?? config.maxArtworkBytes;
    this.ffmpegPath = options.ffmpegPath ?? config.ffmpegPath;
    this.ffprobePath = options.ffprobePath ?? config.ffprobePath;
  }

  async initialize(): Promise<void> {
    await Promise.all([
      mkdir(this.audioDir, { recursive: true }),
      mkdir(this.artworkDir, { recursive: true })
    ]);
    let parsed: LibraryIndex = { version: INDEX_VERSION, assets: [] };
    let mustPersist = false;

    try {
      parsed = JSON.parse(await readFile(this.indexPath, 'utf8')) as LibraryIndex;
      if (![1, 2, 3, INDEX_VERSION].includes(parsed.version) || !Array.isArray(parsed.assets)) {
        throw new Error('Unsupported library index version.');
      }
      mustPersist = parsed.version !== INDEX_VERSION;
    } catch (error) {
      if (!isNodeError(error, 'ENOENT')) throw error;
      mustPersist = true;
    }

    const candidates = new Map<string, AudioAsset>();
    const candidateFilenames = new Set<string>();
    for (const value of parsed.assets) {
      const asset = this.#migrateAsset(value, parsed.version);
      if (!asset || !isManagedFilename(asset.filename)) {
        mustPersist = true;
        continue;
      }
      if (candidates.has(asset.id) || candidateFilenames.has(asset.filename)) {
        mustPersist = true;
        continue;
      }
      candidates.set(asset.id, asset);
      candidateFilenames.add(asset.filename);
    }

    await this.#removeIndexTemps();
    const reconciled = new Map<string, AudioAsset>();
    for (const asset of candidates.values()) {
      const target = this.#managedPath(asset.filename);
      const deleting = `${target}.deleting`;
      let targetStat = await lstat(target).catch(() => null);

      if (!targetStat?.isFile() || targetStat.isSymbolicLink()) {
        if (targetStat) {
          await rm(target, { force: true, recursive: targetStat.isDirectory() });
          mustPersist = true;
        }
        const deletingStat = await lstat(deleting).catch(() => null);
        if (deletingStat?.isFile() && !deletingStat.isSymbolicLink()) {
          await rename(deleting, target);
          await syncDirectory(this.audioDir);
          targetStat = await lstat(target);
          mustPersist = true;
        }
      }

      if (!targetStat?.isFile() || targetStat.isSymbolicLink() || targetStat.size === 0) {
        mustPersist = true;
        continue;
      }

      let reconciledAsset =
        asset.size === targetStat.size ? asset : { ...asset, size: targetStat.size };
      if (reconciledAsset !== asset) mustPersist = true;

      if (reconciledAsset.artworkFilename) {
        const artworkPath = this.#managedArtworkPath(reconciledAsset.artworkFilename);
        const artworkStat = isManagedArtworkFilename(reconciledAsset.artworkFilename)
          ? await lstat(artworkPath).catch(() => null)
          : null;
        if (
          !artworkStat?.isFile() ||
          artworkStat.isSymbolicLink() ||
          artworkStat.size === 0 ||
          artworkStat.size > this.maxArtworkBytes
        ) {
          reconciledAsset = {
            ...reconciledAsset,
            artworkFilename: null,
            artworkMimeType: null,
            artworkSize: 0
          };
          mustPersist = true;
        } else if (reconciledAsset.artworkSize !== artworkStat.size) {
          reconciledAsset = { ...reconciledAsset, artworkSize: artworkStat.size };
          mustPersist = true;
        }
      }
      reconciled.set(asset.id, reconciledAsset);
    }

    const referencedFiles = new Set([...reconciled.values()].map((asset) => asset.filename));
    for (const entry of await readdir(this.audioDir, { withFileTypes: true })) {
      if (referencedFiles.has(entry.name) && entry.isFile() && !entry.isSymbolicLink()) continue;
      await rm(join(this.audioDir, entry.name), { force: true, recursive: entry.isDirectory() });
      mustPersist = true;
    }

    const referencedArtwork = new Set(
      [...reconciled.values()]
        .map((asset) => asset.artworkFilename)
        .filter((filename): filename is string => Boolean(filename))
    );
    for (const entry of await readdir(this.artworkDir, { withFileTypes: true })) {
      if (
        referencedArtwork.has(entry.name) &&
        entry.isFile() &&
        !entry.isSymbolicLink() &&
        isManagedArtworkFilename(entry.name)
      ) {
        continue;
      }
      await rm(join(this.artworkDir, entry.name), {
        force: true,
        recursive: entry.isDirectory()
      });
      mustPersist = true;
    }

    this.#assets = reconciled;
    if (mustPersist) await this.#writeIndex(reconciled);
  }

  list(): AudioAsset[] {
    return this.#sortedAssets(this.#assets);
  }

  get(id: string): AudioAsset | null {
    if (this.#deletingAssets.has(id)) return null;
    return this.#assets.get(id) ?? null;
  }

  filePath(asset: AudioAsset): string {
    return this.#managedPath(asset.filename);
  }

  async add(input: AddAudioInput): Promise<AudioAsset> {
    const originalFilename = cleanOriginalFilename(input.originalFilename);
    if (!originalFilename || extname(originalFilename).toLowerCase() !== '.mp3') {
      throw new Error('Only MP3 files are accepted.');
    }
    if (input.contentLength !== undefined) {
      if (!Number.isSafeInteger(input.contentLength) || input.contentLength < 0) {
        throw new Error('The upload length is invalid.');
      }
      if (input.contentLength > this.maxUploadBytes) throw this.#uploadLimitError();
    }

    const reservation = await this.#reserveUpload(input.contentLength);
    const id = randomUUID();
    const filename = `${id}.mp3`;
    const temporaryPath = join(this.audioDir, `${UPLOAD_TEMP_PREFIX}${id}.tmp`);
    const target = this.#managedPath(filename);

    try {
      const size = await this.#writeUpload(input.stream, temporaryPath, reservation);
      if (size === 0) throw new Error('The uploaded file is empty.');
      const inspection = await this.#inspectMp3(temporaryPath);
      const now = new Date().toISOString();
      const asset: AudioAsset = {
        id,
        name: cleanText(input.name, basename(originalFilename, '.mp3'), 100),
        category: cleanText(
          input.category,
          input.role === 'soundboard' ? 'Effects' : 'Ambience',
          40
        ),
        role: input.role,
        filename,
        originalFilename,
        mimeType: 'audio/mpeg',
        size,
        duration: inspection.duration,
        subtitle: cleanOptionalText(input.subtitle, 100),
        mood: cleanOptionalText(input.mood, 60),
        icon: input.icon ?? (input.role === 'soundboard' ? 'sparkles' : 'music'),
        artworkFilename: null,
        artworkMimeType: null,
        artworkSize: 0,
        createdAt: now,
        updatedAt: now
      };

      return await this.#mutationLock.run(async () => {
        const next = new Map(this.#assets);
        next.set(id, asset);
        await rename(temporaryPath, target);
        await syncDirectory(this.audioDir);
        try {
          await this.#writeIndex(next);
        } catch (error) {
          await rm(target, { force: true });
          await syncDirectory(this.audioDir);
          throw error;
        }
        this.#assets = next;
        return asset;
      });
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      this.#releaseUpload(reservation);
    }
  }

  async update(
    id: string,
    input: Partial<Pick<AudioAsset, 'name' | 'category' | 'role' | 'subtitle' | 'mood' | 'icon'>>
  ): Promise<AudioAsset> {
    return this.#mutationLock.run(async () => {
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
        subtitle:
          input.subtitle === undefined ? current.subtitle : cleanOptionalText(input.subtitle, 100),
        mood: input.mood === undefined ? current.mood : cleanOptionalText(input.mood, 60),
        icon: input.icon ?? current.icon,
        updatedAt: new Date().toISOString()
      };
      const next = new Map(this.#assets);
      next.set(id, updated);
      await this.#writeIndex(next);
      this.#assets = next;
      return updated;
    });
  }

  async delete(id: string): Promise<AudioAsset> {
    if (this.#deletingAssets.has(id) || !this.#assets.has(id)) {
      throw new Error('Audio asset not found.');
    }
    this.#deletingAssets.add(id);
    try {
      return await this.#mutationLock.run(async () => {
        const asset = this.#assets.get(id);
        if (!asset) throw new Error('Audio asset not found.');
        const next = new Map(this.#assets);
        next.delete(id);
        const target = this.filePath(asset);

        try {
          await this.#writeIndex(next);
        } catch (error) {
          if (!isNodeError(error, 'ENOSPC')) throw error;
          const deleting = `${target}.deleting`;
          await rename(target, deleting).catch((renameError) => {
            if (!isNodeError(renameError, 'ENOENT')) throw renameError;
          });
          await rm(deleting, { force: true });
          await syncDirectory(this.audioDir);
          try {
            await this.#writeIndex(next);
          } catch (retryError) {
            // The file has already been removed to recover space. Keep runtime state consistent;
            // startup reconciliation will remove the stale index entry if storage remains unhealthy.
            this.#assets = next;
            throw retryError;
          }
        }

        this.#assets = next;
        await rm(target, { force: true });
        if (asset.artworkFilename) {
          await rm(this.#managedArtworkPath(asset.artworkFilename), { force: true });
          await syncDirectory(this.artworkDir);
        }
        await syncDirectory(this.audioDir);
        return asset;
      });
    } finally {
      this.#deletingAssets.delete(id);
    }
  }

  #managedPath(filename: string): string {
    if (!isManagedFilename(filename)) throw new Error('The audio asset has an unsafe filename.');
    const path = resolve(this.audioDir, filename);
    if (dirname(path) !== resolve(this.audioDir)) {
      throw new Error('The audio asset has an unsafe filename.');
    }
    return path;
  }

  artworkPath(asset: AudioAsset): string | null {
    return asset.artworkFilename ? this.#managedArtworkPath(asset.artworkFilename) : null;
  }

  async setArtwork(id: string, bytes: Uint8Array, mimeType: ArtworkMimeType): Promise<AudioAsset> {
    if (bytes.byteLength === 0) throw new Error('The artwork file is empty.');
    if (bytes.byteLength > this.maxArtworkBytes) {
      const limit =
        this.maxArtworkBytes >= 1024 * 1024
          ? `${Math.round(this.maxArtworkBytes / 1024 / 1024)} MB`
          : `${this.maxArtworkBytes} bytes`;
      throw new Error(`Artwork must be ${limit} or smaller.`);
    }
    this.#validateArtwork(bytes, mimeType);

    return this.#mutationLock.run(async () => {
      const current = this.#assets.get(id);
      if (!current) throw new Error('Audio asset not found.');
      const reservation = await this.#reserveArtwork(current.artworkSize, bytes.byteLength);
      const extension = mimeType === 'image/png' ? '.png' : '.jpg';
      const filename = `${id}-${randomUUID()}${extension}`;
      const temporaryPath = join(this.artworkDir, `${ARTWORK_TEMP_PREFIX}${randomUUID()}.tmp`);
      const targetPath = this.#managedArtworkPath(filename);
      let targetExists = false;
      let committed = false;
      try {
        const file = await open(
          temporaryPath,
          fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
          0o640
        );
        try {
          await file.writeFile(bytes);
          await file.sync();
        } finally {
          await file.close();
        }

        const updated: AudioAsset = {
          ...current,
          artworkFilename: filename,
          artworkMimeType: mimeType,
          artworkSize: bytes.byteLength,
          updatedAt: new Date().toISOString()
        };
        const next = new Map(this.#assets);
        next.set(id, updated);
        await rename(temporaryPath, targetPath);
        targetExists = true;
        await syncDirectory(this.artworkDir);
        await this.#writeIndex(next);
        this.#assets = next;
        committed = true;

        if (current.artworkFilename) {
          await rm(this.#managedArtworkPath(current.artworkFilename), { force: true }).catch(
            (error) => {
              console.error(
                `Audio artwork cleanup: ${
                  error instanceof Error ? error.message : 'unknown cleanup error'
                }`
              );
            }
          );
          await syncDirectory(this.artworkDir).catch(() => undefined);
        }
        return updated;
      } finally {
        await rm(temporaryPath, { force: true }).catch(() => undefined);
        if (!committed && targetExists) {
          await rm(targetPath, { force: true }).catch(() => undefined);
          await syncDirectory(this.artworkDir).catch(() => undefined);
        }
        this.#releaseArtwork(reservation);
      }
    });
  }

  async removeArtwork(id: string): Promise<AudioAsset> {
    return this.#mutationLock.run(async () => {
      const current = this.#assets.get(id);
      if (!current) throw new Error('Audio asset not found.');
      if (!current.artworkFilename) return current;
      const updated: AudioAsset = {
        ...current,
        artworkFilename: null,
        artworkMimeType: null,
        artworkSize: 0,
        updatedAt: new Date().toISOString()
      };
      const next = new Map(this.#assets);
      next.set(id, updated);
      await this.#writeIndex(next);
      this.#assets = next;
      await rm(this.#managedArtworkPath(current.artworkFilename), { force: true });
      await syncDirectory(this.artworkDir);
      return updated;
    });
  }

  #managedArtworkPath(filename: string): string {
    if (!isManagedArtworkFilename(filename)) {
      throw new Error('The audio artwork has an unsafe filename.');
    }
    const path = resolve(this.artworkDir, filename);
    if (dirname(path) !== resolve(this.artworkDir)) {
      throw new Error('The audio artwork has an unsafe filename.');
    }
    return path;
  }

  #validateArtwork(bytes: Uint8Array, mimeType: ArtworkMimeType): void {
    const validPng =
      bytes.byteLength >= 8 &&
      Buffer.from(bytes.subarray(0, 8)).equals(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      );
    const validJpeg =
      bytes.byteLength >= 4 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff &&
      bytes.at(-2) === 0xff &&
      bytes.at(-1) === 0xd9;
    if ((mimeType === 'image/png' && !validPng) || (mimeType === 'image/jpeg' && !validJpeg)) {
      throw new Error('Artwork must be a valid PNG or JPEG image.');
    }
  }

  #migrateAsset(value: unknown, version: number): AudioAsset | null {
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    if (
      typeof record.id !== 'string' ||
      record.id.length === 0 ||
      typeof record.name !== 'string'
    ) {
      return null;
    }

    const filename = typeof record.filename === 'string' ? record.filename : null;
    if (version === 2 && !filename) return null;
    if (!filename) return null;
    const role = record.role === 'ambience' ? 'ambience' : 'soundboard';
    return {
      id: record.id,
      name: cleanText(record.name, 'Untitled audio', 100),
      category: cleanText(
        typeof record.category === 'string' ? record.category : '',
        'Uncategorized',
        40
      ),
      role,
      filename,
      originalFilename:
        cleanOriginalFilename(
          typeof record.originalFilename === 'string' ? record.originalFilename : filename
        ) || basename(filename),
      mimeType: 'audio/mpeg',
      size:
        typeof record.size === 'number' && Number.isFinite(record.size) && record.size >= 0
          ? record.size
          : 0,
      duration:
        typeof record.duration === 'number' &&
        Number.isFinite(record.duration) &&
        record.duration > 0
          ? record.duration
          : null,
      subtitle: cleanOptionalText(
        typeof record.subtitle === 'string' ? record.subtitle : undefined,
        100
      ),
      mood: cleanOptionalText(typeof record.mood === 'string' ? record.mood : undefined, 60),
      icon: ASSET_ICONS.includes(record.icon as AssetIcon)
        ? (record.icon as AssetIcon)
        : role === 'soundboard'
          ? 'sparkles'
          : 'music',
      artworkFilename:
        typeof record.artworkFilename === 'string' &&
        isManagedArtworkFilename(record.artworkFilename)
          ? record.artworkFilename
          : null,
      artworkMimeType:
        record.artworkMimeType === 'image/jpeg' || record.artworkMimeType === 'image/png'
          ? record.artworkMimeType
          : null,
      artworkSize:
        typeof record.artworkSize === 'number' &&
        Number.isFinite(record.artworkSize) &&
        record.artworkSize >= 0
          ? record.artworkSize
          : 0,
      createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString(),
      updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date().toISOString()
    };
  }

  async #reserveUpload(contentLength?: number): Promise<UploadReservation> {
    return this.#quotaLock.run(async () => {
      if (this.#activeUploads >= this.maxConcurrentUploads) {
        throw new UploadBusyError(
          'Another audio upload is already being processed. Try again shortly.'
        );
      }
      const budget = contentLength ?? this.maxUploadBytes;
      const currentBytes = this.#managedBytes();
      if (currentBytes + this.#uploadBudgets + budget > this.maxLibraryBytes) {
        throw new LibraryQuotaError('The audio library storage quota would be exceeded.');
      }

      this.#activeUploads += 1;
      this.#uploadBudgets += budget;
      this.#remainingDiskReservations += budget;
      try {
        await this.#assertFreeSpace(0);
      } catch (error) {
        this.#activeUploads -= 1;
        this.#uploadBudgets -= budget;
        this.#remainingDiskReservations -= budget;
        throw error;
      }
      return { budget, remaining: budget };
    });
  }

  async #growReservation(reservation: UploadReservation, requiredBudget: number): Promise<void> {
    if (requiredBudget <= reservation.budget) return;
    const delta = requiredBudget - reservation.budget;
    await this.#quotaLock.run(async () => {
      const currentBytes = this.#managedBytes();
      if (currentBytes + this.#uploadBudgets + delta > this.maxLibraryBytes) {
        throw new LibraryQuotaError('The audio library storage quota would be exceeded.');
      }
      await this.#assertFreeSpace(delta);
      reservation.budget += delta;
      reservation.remaining += delta;
      this.#uploadBudgets += delta;
      this.#remainingDiskReservations += delta;
    });
  }

  #releaseUpload(reservation: UploadReservation): void {
    this.#activeUploads -= 1;
    this.#uploadBudgets -= reservation.budget;
    this.#remainingDiskReservations -= reservation.remaining;
  }

  async #reserveArtwork(replacedBytes: number, newBytes: number): Promise<ArtworkReservation> {
    return this.#quotaLock.run(async () => {
      const quotaBudget = Math.max(0, newBytes - replacedBytes);
      if (this.#managedBytes() + this.#uploadBudgets + quotaBudget > this.maxLibraryBytes) {
        throw new LibraryQuotaError('The audio library storage quota would be exceeded.');
      }
      await this.#assertFreeSpace(newBytes);
      this.#uploadBudgets += quotaBudget;
      this.#remainingDiskReservations += newBytes;
      return { quotaBudget, diskBudget: newBytes };
    });
  }

  #releaseArtwork(reservation: ArtworkReservation): void {
    this.#uploadBudgets -= reservation.quotaBudget;
    this.#remainingDiskReservations -= reservation.diskBudget;
  }

  #managedBytes(): number {
    return this.list().reduce((total, asset) => total + asset.size + asset.artworkSize, 0);
  }

  async #assertFreeSpace(additionalReservation: number): Promise<void> {
    const storage = await statfs(this.audioDir);
    const available = storage.bavail * storage.bsize;
    if (available < this.minFreeBytes + this.#remainingDiskReservations + additionalReservation) {
      throw new LibraryQuotaError('There is not enough free space to safely store this upload.');
    }
  }

  async #writeUpload(
    stream: ReadableStream<Uint8Array>,
    path: string,
    reservation: UploadReservation
  ): Promise<number> {
    const reader = stream.getReader();
    let file: FileHandle | undefined;
    let size = 0;
    let completed = false;
    try {
      file = await open(
        path,
        fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
        0o640
      );
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        const chunk = result.value;
        if (chunk.byteLength === 0) continue;
        const nextSize = size + chunk.byteLength;
        if (nextSize > this.maxUploadBytes) throw this.#uploadLimitError();
        await this.#growReservation(reservation, nextSize);

        const buffer = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
        let offset = 0;
        while (offset < buffer.byteLength) {
          const result = await file.write(buffer, offset, buffer.byteLength - offset);
          if (result.bytesWritten === 0) throw new Error('The upload could not be written.');
          offset += result.bytesWritten;
        }
        size = nextSize;
        const consumed = Math.min(chunk.byteLength, reservation.remaining);
        reservation.remaining -= consumed;
        this.#remainingDiskReservations -= consumed;
      }
      await file.sync();
      completed = true;
      return size;
    } catch (error) {
      await reader.cancel(error).catch(() => undefined);
      throw error;
    } finally {
      reader.releaseLock();
      try {
        await file?.close();
      } finally {
        if (!completed) await rm(path, { force: true }).catch(() => undefined);
      }
    }
  }

  #uploadLimitError(): UploadLimitError {
    return new UploadLimitError(
      `The upload exceeds the ${Math.round(this.maxUploadBytes / 1024 / 1024)} MB limit.`
    );
  }

  async #inspectMp3(path: string): Promise<Mp3Inspection> {
    try {
      const { stdout } = await execFileAsync(
        this.ffprobePath,
        [
          '-v',
          'error',
          '-select_streams',
          'a:0',
          '-show_entries',
          'stream=codec_name,codec_type:format=duration,format_name',
          '-of',
          'json',
          path
        ],
        { timeout: 30_000, maxBuffer: 1024 * 1024 }
      );
      const parsed = JSON.parse(stdout) as {
        streams?: Array<{ codec_name?: unknown; codec_type?: unknown }>;
        format?: { duration?: unknown; format_name?: unknown };
      };
      const hasMp3Stream = parsed.streams?.some(
        (stream) => stream.codec_type === 'audio' && stream.codec_name === 'mp3'
      );
      const formatNames =
        typeof parsed.format?.format_name === 'string' ? parsed.format.format_name.split(',') : [];
      if (!hasMp3Stream || !formatNames.includes('mp3')) throw new Error('Not an MP3 stream.');

      await execFileAsync(
        this.ffmpegPath,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-xerror',
          '-nostdin',
          '-i',
          path,
          '-map',
          '0:a:0',
          '-f',
          'null',
          '-'
        ],
        { timeout: 5 * 60_000, maxBuffer: 1024 * 1024 }
      );
      const duration = Number.parseFloat(String(parsed.format?.duration ?? ''));
      if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error('The MP3 duration is invalid.');
      }
      return { duration };
    } catch {
      throw new Error('Only valid MP3 files are accepted.');
    }
  }

  async #removeIndexTemps(): Promise<void> {
    for (const entry of await readdir(this.dataDir, { withFileTypes: true })) {
      const isCurrentTemp = entry.name.startsWith(INDEX_TEMP_PREFIX);
      const isLegacyTemp =
        entry.name.startsWith(`${basename(this.indexPath)}.`) && entry.name.endsWith('.tmp');
      if (!isCurrentTemp && !isLegacyTemp) continue;
      await rm(join(this.dataDir, entry.name), { force: true, recursive: entry.isDirectory() });
    }
  }

  async #writeIndex(assets: Map<string, AudioAsset>): Promise<void> {
    const temporaryPath = join(
      this.dataDir,
      `${INDEX_TEMP_PREFIX}${process.pid}-${randomUUID()}.tmp`
    );
    const file = await open(
      temporaryPath,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
      0o640
    );
    try {
      const index: LibraryIndex = { version: INDEX_VERSION, assets: this.#sortedAssets(assets) };
      await file.writeFile(`${JSON.stringify(index, null, 2)}\n`, 'utf8');
      await file.sync();
    } catch (error) {
      await file.close().catch(() => undefined);
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
    await file.close();
    try {
      await rename(temporaryPath, this.indexPath);
      await syncDirectory(this.dataDir);
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }

  #sortedAssets(assets: Map<string, AudioAsset>): AudioAsset[] {
    return [...assets.values()].sort((a, b) => {
      if (a.role !== b.role) return a.role.localeCompare(b.role);
      if (a.category !== b.category) return a.category.localeCompare(b.category);
      return a.name.localeCompare(b.name);
    });
  }
}
