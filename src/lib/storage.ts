/**
 * Persistence.
 *
 * Packs go in IndexedDB — they can be a megabyte or two and localStorage
 * would choke. Progress and settings go in localStorage, because they are
 * small and being able to read them synchronously on first paint avoids a
 * flash of empty state.
 *
 * Every accessor is defensive. Private windows, cleared site data, browsers
 * set to block storage, and thumbnail renderers all show up here as thrown
 * exceptions or missing databases, and none of them should break the app —
 * they just mean nothing was saved.
 */

import type { Pack } from '../types/pack'
import { emptyProgress, type PackProgress } from './progress'

const DB_NAME = 'overlearn'
const DB_VERSION = 1
const PACK_STORE = 'packs'

const LS_PROGRESS = 'overlearn:progress:'
const LS_SETTINGS = 'overlearn:settings'
const LS_LAST_PACK = 'overlearn:lastPack'

/* ------------------------------------------------------------------ *
 * IndexedDB
 * ------------------------------------------------------------------ */

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') {
        resolve(null)
        return
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(PACK_STORE)) {
          db.createObjectStore(PACK_STORE, { keyPath: 'id' })
        }
      }

      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
      request.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })

  return dbPromise
}

function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null)
          return
        }
        try {
          const transaction = db.transaction(PACK_STORE, mode)
          const request = run(transaction.objectStore(PACK_STORE))
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => resolve(null)
          transaction.onerror = () => resolve(null)
          transaction.onabort = () => resolve(null)
        } catch {
          resolve(null)
        }
      }),
  )
}

interface StoredPack {
  id: string
  pack: Pack
}

export async function savePack(pack: Pack): Promise<void> {
  await tx('readwrite', (store) => store.put({ id: pack.manifest.id, pack } satisfies StoredPack))
}

export async function loadPacks(): Promise<Pack[]> {
  const rows = await tx<StoredPack[]>('readonly', (store) => store.getAll() as IDBRequest<StoredPack[]>)
  if (!rows) return []
  return rows.map((r) => r.pack).filter((p): p is Pack => !!p && !!p.manifest)
}

export async function deletePack(packId: string): Promise<void> {
  await tx('readwrite', (store) => store.delete(packId) as unknown as IDBRequest<undefined>)
}

/* ------------------------------------------------------------------ *
 * localStorage
 * ------------------------------------------------------------------ */

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeLocal(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Quota exceeded, or storage disabled. Losing progress is bad but
    // crashing mid-session is worse.
  }
}

function removeLocal(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* nothing to do */
  }
}

/* -- progress ------------------------------------------------------- */

export function loadProgress(packId: string): PackProgress {
  const stored = readLocal<PackProgress | null>(LS_PROGRESS + packId, null)
  if (!stored || typeof stored !== 'object' || !stored.questions) return emptyProgress(packId)
  return {
    packId,
    questions: stored.questions ?? {},
    sessions: Array.isArray(stored.sessions) ? stored.sessions : [],
    totalMs: typeof stored.totalMs === 'number' ? stored.totalMs : 0,
    updatedAt: stored.updatedAt ?? Date.now(),
  }
}

export function saveProgress(progress: PackProgress): void {
  writeLocal(LS_PROGRESS + progress.packId, progress)
}

export function clearProgress(packId: string): void {
  removeLocal(LS_PROGRESS + packId)
}

/* -- settings ------------------------------------------------------- */

export type ThemeChoice = 'system' | 'light' | 'dark'

export interface Settings {
  theme: ThemeChoice
  /** Show the running session clock in the header. */
  showTimer: boolean
  /** Reveal the next computation step with Space as well as clicking. */
  keyboardShortcuts: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  showTimer: true,
  keyboardShortcuts: true,
}

export function loadSettings(): Settings {
  const stored = readLocal<Partial<Settings>>(LS_SETTINGS, {})
  return { ...DEFAULT_SETTINGS, ...stored }
}

export function saveSettings(settings: Settings): void {
  writeLocal(LS_SETTINGS, settings)
}

/* -- last opened ---------------------------------------------------- */

export function loadLastPackId(): string | null {
  return readLocal<string | null>(LS_LAST_PACK, null)
}

export function saveLastPackId(packId: string | null): void {
  if (packId === null) removeLocal(LS_LAST_PACK)
  else writeLocal(LS_LAST_PACK, packId)
}

/* ------------------------------------------------------------------ *
 * Export / import of progress
 * ------------------------------------------------------------------ */

export interface ProgressExport {
  kind: 'overlearn-progress'
  version: 1
  exportedAt: string
  progress: PackProgress
}

export function exportProgress(progress: PackProgress): string {
  const payload: ProgressExport = {
    kind: 'overlearn-progress',
    version: 1,
    exportedAt: new Date().toISOString(),
    progress,
  }
  return JSON.stringify(payload, null, 2)
}

export function parseProgressExport(text: string): PackProgress | null {
  try {
    const parsed = JSON.parse(text) as ProgressExport
    if (parsed.kind !== 'overlearn-progress' || !parsed.progress?.packId) return null
    return parsed.progress
  } catch {
    return null
  }
}
