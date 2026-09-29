/**
 * Local persistence in IndexedDB. The browser's store is the authoritative
 * dataset. Every retrieval mode merges into the same `draws` store, keyed by
 * drawNo, so repeat retrievals never create duplicates.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { sortNewestFirst } from './normalize.ts'
import { DATASET_ID, canonicalSourceFields, toCanonical } from './snapshot.ts'
import type { DatasetMeta, DateRange, LuckyDayDraw, RetrievalMode, StoredDraw, UpsertSummary } from './types.ts'

const DB_NAME = 'uae-lottery'
const DB_VERSION = 1
export const META_SCHEMA_VERSION = 1

interface LotteryDB extends DBSchema {
  draws: { key: string; value: StoredDraw; indexes: { drawDateUae: string } }
  meta: { key: string; value: DatasetMeta }
}

let dbPromise: Promise<IDBPDatabase<LotteryDB>> | null = null

export function getDb(): Promise<IDBPDatabase<LotteryDB>> {
  dbPromise ??= openDB<LotteryDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const draws = db.createObjectStore('draws', { keyPath: 'drawNo' })
      draws.createIndex('drawDateUae', 'drawDateUae')
      db.createObjectStore('meta')
    },
  })
  return dbPromise
}

/** For tests: forget the cached connection. */
export async function closeDb() {
  if (dbPromise) (await dbPromise).close()
  dbPromise = null
}

export function emptyMeta(now: string): DatasetMeta {
  return {
    datasetId: DATASET_ID,
    schemaVersion: META_SCHEMA_VERSION,
    createdAt: now,
    lastApiCheckAt: null,
    lastDataChangeAt: null,
    totalDraws: 0,
    oldestDraw: null,
    newestDraw: null,
    apiHistoryStart: null,
    apiHistoryEnd: null,
    snapshotGeneratedAt: null,
    lastMode: null,
    lastRange: null,
    dataRevision: 0,
    lastExportRevision: 0,
    lastExportAt: null,
  }
}

export async function getMeta(): Promise<DatasetMeta | null> {
  return (await (await getDb()).get('meta', DATASET_ID)) ?? null
}

export async function getAllDraws(): Promise<StoredDraw[]> {
  return sortNewestFirst(await (await getDb()).getAll('draws'))
}

export interface UpsertContext {
  mode: RetrievalMode
  range?: DateRange | null
  historyStart?: string | null
  historyEnd?: string | null
  snapshotGeneratedAt?: string | null
  now?: string
}

/** Insert new draws, update changed ones, leave identical ones untouched. */
export async function upsertDraws(draws: LuckyDayDraw[], ctx: UpsertContext): Promise<{ summary: UpsertSummary; meta: DatasetMeta }> {
  const now = ctx.now ?? new Date().toISOString()
  const db = await getDb()
  const tx = db.transaction(['draws', 'meta'], 'readwrite')
  const store = tx.objectStore('draws')
  let added = 0
  let updated = 0
  let unchanged = 0
  for (const draw of draws) {
    const existing = await store.get(draw.drawNo)
    if (!existing) {
      await store.put({ ...toCanonical(draw), firstSeenAt: now, updatedAt: now })
      added++
    } else if (canonicalSourceFields(existing) !== canonicalSourceFields(draw)) {
      await store.put({ ...toCanonical(draw), firstSeenAt: existing.firstSeenAt, updatedAt: now })
      updated++
    } else {
      unchanged++
    }
  }

  const all = sortNewestFirst(await store.getAll())
  const metaStore = tx.objectStore('meta')
  const prev = (await metaStore.get(DATASET_ID)) ?? emptyMeta(now)
  const changed = added + updated > 0
  const meta: DatasetMeta = {
    ...prev,
    lastApiCheckAt: now,
    lastDataChangeAt: changed ? now : prev.lastDataChangeAt,
    totalDraws: all.length,
    newestDraw: all.length ? { drawNo: all[0].drawNo, date: all[0].drawDateUae } : null,
    oldestDraw: all.length ? { drawNo: all[all.length - 1].drawNo, date: all[all.length - 1].drawDateUae } : null,
    apiHistoryStart: ctx.historyStart ?? prev.apiHistoryStart,
    apiHistoryEnd: ctx.historyEnd ?? prev.apiHistoryEnd,
    snapshotGeneratedAt: ctx.snapshotGeneratedAt ?? prev.snapshotGeneratedAt,
    lastMode: ctx.mode,
    lastRange: ctx.range ?? null,
    dataRevision: changed ? prev.dataRevision + 1 : prev.dataRevision,
  }
  await metaStore.put(meta, DATASET_ID)
  await tx.done
  return { summary: { added, updated, unchanged, total: all.length }, meta }
}

/** Record that the current dataRevision has been exported to XLSX. */
export async function markExported(now = new Date().toISOString()): Promise<DatasetMeta | null> {
  const db = await getDb()
  const meta = await db.get('meta', DATASET_ID)
  if (!meta) return null
  const next = { ...meta, lastExportRevision: meta.dataRevision, lastExportAt: now }
  await db.put('meta', next, DATASET_ID)
  return next
}

/** Draws added or changed after the last export (null if never exported). */
export function countChangedSince(draws: StoredDraw[], since: string | null): number | null {
  return since ? draws.filter((d) => d.updatedAt > since).length : null
}

/** Remove all locally stored draws and metadata. */
export async function clearAll(): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(['draws', 'meta'], 'readwrite')
  await Promise.all([tx.objectStore('draws').clear(), tx.objectStore('meta').clear(), tx.done])
}
