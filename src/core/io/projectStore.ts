/**
 * IndexedDB-backed project store: the autosave target and the source for the
 * recent-projects list. One record per project, keyed by `Project.id`. Two
 * object stores share one database: voxel projects and pixel projects are
 * independent workspaces, but there is no reason to make the browser open
 * two databases for them.
 */
import type { ProjectJson } from '@/core/project/types';
import type { PixelProjectJson } from '@/core/pixel/types';

const DB_NAME = 'voxelix';
const DB_VERSION = 2;
const STORE = 'projects';
const PIXEL_STORE = 'pixelProjects';

export interface ProjectRecord {
  id: string;
  name: string;
  objectCount: number;
  createdAt: number;
  updatedAt: number;
  json: ProjectJson;
  /** small JPEG data URL of the viewport at last save, for the recent list */
  thumbnail?: string;
}

/** Everything about a stored project except its (large) voxel payload. */
export type ProjectMeta = Omit<ProjectRecord, 'json'>;

export interface PixelProjectRecord {
  id: string;
  name: string;
  widgetCount: number;
  createdAt: number;
  updatedAt: number;
  json: PixelProjectJson;
  /** small PNG data URL of the active widget, for the recent list */
  thumbnail?: string;
}

export type PixelProjectMeta = Omit<PixelProjectRecord, 'json'>;

export function isProjectStoreAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined';
  } catch {
    return false;
  }
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id' });
        os.createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains(PIXEL_STORE)) {
        const os = db.createObjectStore(PIXEL_STORE, { keyPath: 'id' });
        os.createIndex('updatedAt', 'updatedAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB upgrade blocked — close other Voxelix tabs and retry'));
  }).catch((err) => {
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function store(db: IDBDatabase, name: string, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(name, mode).objectStore(name);
}

export async function putProjectRecord(record: ProjectRecord): Promise<void> {
  const db = await openDb();
  await promisify(store(db, STORE, 'readwrite').put(record));
}

export async function getProjectRecord(id: string): Promise<ProjectRecord | undefined> {
  const db = await openDb();
  return promisify(store(db, STORE, 'readonly').get(id));
}

export async function deleteProjectRecord(id: string): Promise<void> {
  const db = await openDb();
  await promisify(store(db, STORE, 'readwrite').delete(id));
}

/** All stored projects, newest first, without their voxel payloads. */
export async function listProjectMeta(): Promise<ProjectMeta[]> {
  const db = await openDb();
  const all = await promisify<ProjectRecord[]>(store(db, STORE, 'readonly').getAll());
  return all
    .map(({ json: _json, ...meta }) => meta)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Bump `updatedAt` without rewriting the payload (e.g. on open). No-op if absent. */
export async function touchProjectRecord(id: string): Promise<void> {
  const existing = await getProjectRecord(id);
  if (!existing) return;
  existing.updatedAt = Date.now();
  await putProjectRecord(existing);
}

// ---- pixel projects -------------------------------------------------------

export async function putPixelProjectRecord(record: PixelProjectRecord): Promise<void> {
  const db = await openDb();
  await promisify(store(db, PIXEL_STORE, 'readwrite').put(record));
}

export async function getPixelProjectRecord(id: string): Promise<PixelProjectRecord | undefined> {
  const db = await openDb();
  return promisify(store(db, PIXEL_STORE, 'readonly').get(id));
}

export async function deletePixelProjectRecord(id: string): Promise<void> {
  const db = await openDb();
  await promisify(store(db, PIXEL_STORE, 'readwrite').delete(id));
}

export async function listPixelProjectMeta(): Promise<PixelProjectMeta[]> {
  const db = await openDb();
  const all = await promisify<PixelProjectRecord[]>(store(db, PIXEL_STORE, 'readonly').getAll());
  return all
    .map(({ json: _json, ...meta }) => meta)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function touchPixelProjectRecord(id: string): Promise<void> {
  const existing = await getPixelProjectRecord(id);
  if (!existing) return;
  existing.updatedAt = Date.now();
  await putPixelProjectRecord(existing);
}
