import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { SceneCollection } from '$lib/types';
import { config } from './config';

const SCENES_VERSION = 2;
const SCENES_TEMP_PREFIX = '.scenes-';
const MAX_NAME_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_ASSIGNMENTS = 1_000;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

interface StoredScenes {
  version: unknown;
  scenes: unknown;
}

export interface CreateSceneInput {
  name: string;
  description?: string;
  trackIds?: readonly string[];
  effectIds?: readonly string[];
}

export interface UpdateSceneInput {
  name?: string;
  description?: string;
  trackIds?: readonly string[];
  effectIds?: readonly string[];
}

export interface SceneReferenceCleanup {
  updated: SceneCollection[];
  deleted: SceneCollection[];
}

export class SceneNotFoundError extends Error {}

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

function cleanedText(value: string, label: string, maxLength: number, required: boolean): string {
  if (typeof value !== 'string') throw new Error(`${label} must be text.`);
  const cleaned = value.replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim();
  if (required && !cleaned) throw new Error(`${label} is required.`);
  if (cleaned.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer.`);
  }
  return cleaned;
}

function cleanedPersistedText(value: unknown, maxLength: number, required: boolean): string | null {
  if (typeof value !== 'string') return required ? null : '';
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f\s]+/g, ' ')
    .trim()
    .slice(0, maxLength);
  if (required && !cleaned) return null;
  return cleaned;
}

function cleanedId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim();
  return ID_PATTERN.test(cleaned) ? cleaned : null;
}

function cleanedIds(value: readonly string[] | undefined, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be a list.`);
  if (value.length > MAX_ASSIGNMENTS) {
    throw new Error(`${label} cannot contain more than ${MAX_ASSIGNMENTS} assets.`);
  }

  const result: string[] = [];
  const seen = new Set<string>();
  for (const rawId of value) {
    const id = cleanedId(rawId);
    if (!id) throw new Error(`${label} contains an invalid asset id.`);
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

function cleanedPersistedIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_ASSIGNMENTS) return null;
  const result: string[] = [];
  const seen = new Set<string>();
  for (const rawId of value) {
    const id = cleanedId(rawId);
    if (!id) return null;
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

function validTimestamp(value: unknown, fallback: string): string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : fallback;
}

function arraysEqual(left: unknown, right: readonly string[]): boolean {
  return (
    Array.isArray(left) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function cloneScene(scene: SceneCollection): SceneCollection {
  return {
    ...scene,
    trackIds: [...scene.trackIds],
    effectIds: [...scene.effectIds]
  };
}

function requireAssignments(trackIds: readonly string[], effectIds: readonly string[]): void {
  if (trackIds.length === 0 && effectIds.length === 0) {
    throw new Error('A scene must contain at least one background track or sound effect.');
  }
}

export class SceneStore {
  readonly indexPath: string;
  #scenes = new Map<string, SceneCollection>();
  #mutationLock = new AsyncLock();
  #initialization: Promise<void> | null = null;

  constructor(readonly dataDir = config.dataDir) {
    this.indexPath = join(dataDir, 'scenes.json');
  }

  initialize(): Promise<void> {
    if (this.#initialization) return this.#initialization;
    this.#initialization = this.#initialize();
    return this.#initialization;
  }

  list(): SceneCollection[] {
    return [...this.#scenes.values()].map(cloneScene);
  }

  get(id: string): SceneCollection | null {
    const scene = this.#scenes.get(id);
    return scene ? cloneScene(scene) : null;
  }

  async create(input: CreateSceneInput): Promise<SceneCollection> {
    const name = cleanedText(input.name, 'Scene name', MAX_NAME_LENGTH, true);
    const description = cleanedText(
      input.description ?? '',
      'Scene description',
      MAX_DESCRIPTION_LENGTH,
      false
    );
    const trackIds = cleanedIds(input.trackIds, 'Background tracks');
    const effectIds = cleanedIds(input.effectIds, 'Sound effects');
    requireAssignments(trackIds, effectIds);

    return this.#mutationLock.run(async () => {
      const timestamp = new Date().toISOString();
      const scene: SceneCollection = {
        id: randomUUID(),
        name,
        description,
        trackIds,
        effectIds,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      const next = new Map(this.#scenes);
      next.set(scene.id, scene);
      await this.#writeIndex(next);
      this.#scenes = next;
      return cloneScene(scene);
    });
  }

  async update(id: string, input: UpdateSceneInput): Promise<SceneCollection> {
    if (
      input.name === undefined &&
      input.description === undefined &&
      input.trackIds === undefined &&
      input.effectIds === undefined
    ) {
      throw new Error('Provide at least one scene field to update.');
    }

    return this.#mutationLock.run(async () => {
      const current = this.#scenes.get(id);
      if (!current) throw new SceneNotFoundError('Scene not found.');
      const trackIds =
        input.trackIds === undefined
          ? [...current.trackIds]
          : cleanedIds(input.trackIds, 'Background tracks');
      const effectIds =
        input.effectIds === undefined
          ? [...current.effectIds]
          : cleanedIds(input.effectIds, 'Sound effects');
      requireAssignments(trackIds, effectIds);

      const updated: SceneCollection = {
        ...current,
        name:
          input.name === undefined
            ? current.name
            : cleanedText(input.name, 'Scene name', MAX_NAME_LENGTH, true),
        description:
          input.description === undefined
            ? current.description
            : cleanedText(input.description, 'Scene description', MAX_DESCRIPTION_LENGTH, false),
        trackIds,
        effectIds,
        updatedAt: new Date().toISOString()
      };
      const next = new Map(this.#scenes);
      next.set(id, updated);
      await this.#writeIndex(next);
      this.#scenes = next;
      return cloneScene(updated);
    });
  }

  async delete(id: string): Promise<SceneCollection> {
    return this.#mutationLock.run(async () => {
      const current = this.#scenes.get(id);
      if (!current) throw new SceneNotFoundError('Scene not found.');
      const next = new Map(this.#scenes);
      next.delete(id);
      await this.#writeIndex(next);
      this.#scenes = next;
      return cloneScene(current);
    });
  }

  async removeAssetReferences(assetId: string): Promise<SceneReferenceCleanup> {
    const cleanedAssetId = cleanedId(assetId);
    if (!cleanedAssetId) throw new Error('Asset id is invalid.');

    return this.#mutationLock.run(async () => {
      const next = new Map(this.#scenes);
      const updated: SceneCollection[] = [];
      const deleted: SceneCollection[] = [];
      const timestamp = new Date().toISOString();

      for (const [id, current] of this.#scenes) {
        const trackIds = current.trackIds.filter((candidate) => candidate !== cleanedAssetId);
        const effectIds = current.effectIds.filter((candidate) => candidate !== cleanedAssetId);
        if (
          trackIds.length === current.trackIds.length &&
          effectIds.length === current.effectIds.length
        ) {
          continue;
        }

        if (trackIds.length === 0 && effectIds.length === 0) {
          next.delete(id);
          deleted.push(cloneScene(current));
          continue;
        }

        const scene = { ...current, trackIds, effectIds, updatedAt: timestamp };
        next.set(id, scene);
        updated.push(cloneScene(scene));
      }

      if (updated.length === 0 && deleted.length === 0) return { updated, deleted };
      await this.#writeIndex(next);
      this.#scenes = next;
      return { updated, deleted };
    });
  }

  async #initialize(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    await this.#removeTemps();

    let stored: StoredScenes;
    try {
      stored = JSON.parse(await readFile(this.indexPath, 'utf8')) as StoredScenes;
    } catch (error) {
      if (!isNodeError(error, 'ENOENT')) throw error;
      const empty = new Map<string, SceneCollection>();
      await this.#writeIndex(empty);
      this.#scenes = empty;
      return;
    }

    if (
      !stored ||
      typeof stored !== 'object' ||
      (stored.version !== 1 && stored.version !== SCENES_VERSION) ||
      !Array.isArray(stored.scenes)
    ) {
      throw new Error('Unsupported scene collection index.');
    }

    const migrationTime = new Date().toISOString();
    const candidates = new Map<string, SceneCollection>();
    let mustPersist = stored.version !== SCENES_VERSION;
    for (const value of stored.scenes) {
      const migrated = this.#migrateScene(value, stored.version, migrationTime);
      if (!migrated || candidates.has(migrated.scene.id)) {
        mustPersist = true;
        continue;
      }
      candidates.set(migrated.scene.id, migrated.scene);
      if (migrated.changed) mustPersist = true;
    }

    if (mustPersist) await this.#writeIndex(candidates);
    this.#scenes = candidates;
  }

  #migrateScene(
    value: unknown,
    version: 1 | typeof SCENES_VERSION,
    migrationTime: string
  ): { scene: SceneCollection; changed: boolean } | null {
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    const id = cleanedId(record.id);
    const name = cleanedPersistedText(record.name, MAX_NAME_LENGTH, true);
    const description = cleanedPersistedText(record.description, MAX_DESCRIPTION_LENGTH, false);
    const trackIds = cleanedPersistedIds(record.trackIds);
    const effectIds = cleanedPersistedIds(record.effectIds);
    if (!id || name === null || description === null || !trackIds || !effectIds) return null;
    if (trackIds.length === 0 && effectIds.length === 0) return null;

    const createdAt =
      version === 1 ? migrationTime : validTimestamp(record.createdAt, migrationTime);
    const updatedAt = version === 1 ? createdAt : validTimestamp(record.updatedAt, createdAt);
    const scene: SceneCollection = {
      id,
      name,
      description,
      trackIds,
      effectIds,
      createdAt,
      updatedAt
    };
    const expectedKeys = [
      'createdAt',
      'description',
      'effectIds',
      'id',
      'name',
      'trackIds',
      'updatedAt'
    ];
    const changed =
      version !== SCENES_VERSION ||
      record.id !== id ||
      record.name !== name ||
      record.description !== description ||
      !arraysEqual(record.trackIds, trackIds) ||
      !arraysEqual(record.effectIds, effectIds) ||
      record.createdAt !== createdAt ||
      record.updatedAt !== updatedAt ||
      Object.keys(record).sort().join('\0') !== expectedKeys.join('\0');
    return { scene, changed };
  }

  async #removeTemps(): Promise<void> {
    for (const entry of await readdir(this.dataDir, { withFileTypes: true })) {
      const isCurrent = entry.name.startsWith(SCENES_TEMP_PREFIX);
      const isLegacy =
        entry.name.startsWith(`${basename(this.indexPath)}.`) && entry.name.endsWith('.tmp');
      if (!isCurrent && !isLegacy) continue;
      await rm(join(this.dataDir, entry.name), {
        force: true,
        recursive: entry.isDirectory()
      });
    }
  }

  async #writeIndex(scenes: Map<string, SceneCollection>): Promise<void> {
    const temporaryPath = join(
      this.dataDir,
      `${SCENES_TEMP_PREFIX}${process.pid}-${randomUUID()}.tmp`
    );
    const file = await open(
      temporaryPath,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
      0o640
    );
    try {
      const stored = {
        version: SCENES_VERSION,
        scenes: [...scenes.values()]
      };
      await file.writeFile(`${JSON.stringify(stored, null, 2)}\n`, 'utf8');
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
}
