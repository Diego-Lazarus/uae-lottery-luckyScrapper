/**
 * Maintain public/data/luckyday.json from the official UAE Lottery API.
 *
 *   npm run snapshot        latest-10 reconciliation (normal scheduled run)
 *   npm run snapshot:full   complete historical rebuild
 *
 * The official latest-results response is authoritative. The script never
 * derives an "expected" draw from today's date. The file is rewritten only
 * when draw data actually changes; `changed=true|false` is written to
 * $GITHUB_OUTPUT so the workflow can skip build/deploy.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchAllDraws, fetchHistoryRange, fetchLatest, type ApiOptions } from '../src/lib/api.ts'
import { sortNewestFirst, uaeParts } from '../src/lib/normalize.ts'
import {
  decideSnapshot, needsFullRebuild, parseSnapshot, reconcile, serializeSnapshot, validateDraws, validateMerge,
} from '../src/lib/snapshot.ts'
import type { LuckyDayDraw, SnapshotFile } from '../src/lib/types.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SNAPSHOT_PATH = resolve(root, 'public/data/luckyday.json')
const api: ApiOptions = {
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; luckyday-snapshot/1.0; +https://github.com/)',
    Referer: 'https://www.theuaelottery.ae/lottery/luckyday/results',
  },
  log: (m) => console.log(m),
}
const summary: string[] = []
const log = (m: string) => { console.log(m); summary.push(m) }

function fail(msg: string): never {
  log(`ERROR: ${msg}`)
  flushSummary()
  process.exit(1)
}

function flushSummary() {
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Lucky Day snapshot\n\n${summary.map((s) => `- ${s}`).join('\n')}\n`)
  }
}

function setOutput(changed: boolean, latest: string | null) {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\nlatest_draw=${latest ?? ''}\n`)
  }
}

function loadExisting(): SnapshotFile | null {
  if (!existsSync(SNAPSHOT_PATH)) return null
  try {
    return parseSnapshot(JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')))
  } catch (e) {
    log(`Existing snapshot is unreadable (${(e as Error).message}); a full rebuild is required.`)
    return null
  }
}

async function fullRebuild(previous: LuckyDayDraw[]): Promise<LuckyDayDraw[]> {
  log('Running full historical rebuild (verified pagination).')
  const all = await fetchAllDraws(api)
  const errors = validateDraws(all)
  if (errors.length) fail(`full history failed validation: ${errors.slice(0, 5).join('; ')}`)
  const mergeErrors = validateMerge(previous, all, 'full')
  if (mergeErrors.length) fail(mergeErrors.join('; '))
  const missing = previous.filter((p) => !all.some((d) => d.drawNo === p.drawNo)).map((d) => d.drawNo)
  if (missing.length) log(`Note: ${missing.length} previously stored draws are no longer returned by the API: ${missing.join(', ')}`)
  return all
}

async function main() {
  const full = process.argv.includes('--full')
  const now = new Date()
  const nowUae = uaeParts(now.getTime())
  const pad = (n: number) => String(n).padStart(2, '0')
  log(`Checked at ${now.toISOString()} (current UAE date ${nowUae.year}-${pad(nowUae.month)}-${pad(nowUae.day)} ${pad(nowUae.hour)}:${pad(nowUae.minute)})`)

  const existing = loadExisting()
  const previous = existing?.draws ?? []
  let merged: LuckyDayDraw[]

  if (full || !existing) {
    if (!existing && !full) log('No existing snapshot found; falling back to full rebuild.')
    merged = await fullRebuild(previous)
  } else {
    const latest = await fetchLatest(api)
    if (!latest.length) fail('the latest-results request returned no draws')
    const errors = validateDraws(latest)
    if (errors.length) fail(`latest results failed validation: ${errors.join('; ')}`)
    const newestStored = sortNewestFirst(previous)[0]
    log(`Latest published draw: ${latest[0].drawNo} (${latest[0].drawDateUae}). Snapshot newest: ${newestStored.drawNo} (${newestStored.drawDateUae}).`)

    const history = await fetchHistoryRange(api).catch(() => null)
    const reason = needsFullRebuild(previous, latest, history?.startDate)
    if (reason) {
      log(`Escalating to full rebuild: ${reason}`)
      merged = await fullRebuild(previous)
    } else {
      const r = reconcile(previous, latest)
      log(`Latest-10 reconciliation: ${r.added.length} new, ${r.updated.length} updated, ${r.unchanged.length} unchanged.`)
      if (r.updated.length) log(`Updated draws: ${r.updated.join(', ')}`)
      const mergeErrors = validateMerge(previous, r.merged, 'incremental')
      if (mergeErrors.length) fail(mergeErrors.join('; '))
      merged = r.merged
    }
  }

  const decision = decideSnapshot(existing, merged, now.toISOString())
  if (!decision.changed) {
    log('No new Lucky Day result has been published yet. Existing snapshot retained.')
  } else {
    mkdirSync(dirname(SNAPSHOT_PATH), { recursive: true })
    writeFileSync(SNAPSHOT_PATH, serializeSnapshot(decision.file))
    log(`New result detected: snapshot now has ${decision.file.drawCount} draws, latest ${decision.file.latestDrawNo} (${decision.file.latestDrawDate}).`)
  }
  setOutput(decision.changed, decision.file.latestDrawNo)
  flushSummary()
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)))
