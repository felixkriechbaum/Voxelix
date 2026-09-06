/**
 * IndexedDB-backed project store: the autosave target and the source for the
 * recent-projects list. One record per project, keyed by `Project.id`.
 */
import type { ProjectJson } from '@/core/project/types';

const DB_NAME = 'voxelix';
const DB_VERSION = 1;
const STORE = 'projects';

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
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another tab'));
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

function store(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE);
}

export async function putProjectRecord(record: ProjectRecord): Promise<void> {
  const db = await openDb();
  await promisify(store(db, 'readwrite').put(record));
}

export async function getProjectRecord(id: string): Promise<ProjectRecord | undefined> {
  const db = await openDb();
  return promisify(store(db, 'readonly').get(id));
}

export async function deleteProjectRecord(id: string): Promise<void> {
  const db = await openDb();
  await promisify(store(db, 'readwrite').delete(id));
}

/** All stored projects, newest first, without their voxel payloads. */
export async function listProjectMeta(): Promise<ProjectMeta[]> {
  const db = await openDb();
  const all = await promisify<ProjectRecord[]>(store(db, 'readonly').getAll());
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
