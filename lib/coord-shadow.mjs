// Shadow coord store (WA-1370, the WA-1367 gate's step 2): peers runs on its files as before; each holder or queue
// change also goes to the store named by config `coord`, and a flush compares the two.
// Commands only write an op file and start a detached flush: no command waits on the store.
// flush: ops in order (each ≤ 2 s), renew this machine's live holders, expire its lapsed leases, then the diff.
// A diff seen on two flushes in a row is fixed in the store, so one miss is logged once, not for a day.
// Store down or failing to load: files only, the op files wait (an hour at most), one warning per new error.
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, appendFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileStore } from './coord-files.mjs'
import { statusesOf } from './board.mjs'

const fold = id => String(id).toLowerCase()
const KEEP = 3600e3 // an op file older than this is dropped (the diff fixes what it missed)
const readJson = (p, d = null) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return d
  }
}
const writeJson = (p, v) => {
  const tmp = `${p}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(v))
  renameSync(tmp, p)
}

export const coordShadow = ({ home, config: c0, who }) => {
  // PEERS_COORD: the smokes' switch (scripts/smoke-coord-shadow.sh)
  const config = process.env.PEERS_COORD ? { ...c0, coord: process.env.PEERS_COORD } : c0
  if (!config?.coord) return null
  const run = join(home, '.claude', 'peers-run')
  const out = join(run, 'coord-outbox')
  const health = join(run, 'coord-health.json')
  const diffs = join(run, 'coord-diff.jsonl')
  const lastPath = join(run, 'coord-last.json')
  const lockDir = join(run, 'coord-flush.lock')
  const leaseMs = (Number(config.coordLeaseSec) || 300) * 1000
  const ms = Number(config.coordTimeoutMs) || 2000
  const log = v => {
    mkdirSync(run, { recursive: true })
    appendFileSync(diffs, `${JSON.stringify({ at: Date.now(), ...v })}\n`)
  }
  const timed = (p, what) =>
    Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`${what}: no answer in ${ms} ms`)), ms).unref())])
  const load = async () => {
    if (config.coord === 'files') return fileStore({ dir: join(run, 'coord-files') })
    const p = isAbsolute(config.coord) ? config.coord : join(home, '.claude', 'peers', config.coord)
    const make = (await import(pathToFileURL(p).href)).default
    return make(config, who, { fileStore, statusesOf })
  }

  // A command's op: written now, applied by the flush.
  const put = op => {
    try {
      mkdirSync(out, { recursive: true })
      // µs wall clock: ops written under the board lock sort in lock order across processes
      writeFileSync(join(out, `${(performance.timeOrigin + performance.now()).toFixed(3).padStart(18, '0')}-${process.pid}.json`), JSON.stringify({ at: Date.now(), ...op }))
    } catch {}
  }
  // the flush runs apart from the command: the command never waits on the store
  const kick = peersPath => {
    try {
      spawn(process.execPath, [peersPath, 'coord', 'flush'], { detached: true, stdio: 'ignore', env: process.env }).unref()
    } catch {}
  }
  // one line on stderr per new error, from any command
  const warn = () => {
    const h = readJson(health)
    if (!h || h.ok || h.warned) return null
    try {
      writeJson(health, { ...h, warned: true })
    } catch {}
    return `peers: coord store (${config.coord}) failing: ${h.error}; peers runs on its files, as before. \`peers coord\` shows more.`
  }
  const ok = (h, v) => {
    const was = readJson(health)
    // a new error warns again; the same error stays told
    const warned = !v.ok && was && !was.ok && was.error === v.error ? was.warned : false
    writeJson(health, { ...h, ...v, warned, at: Date.now() })
  }

  // truth(): { live: Map task → ['who/holder'] (this machine), queue: [{ task, lane, pin }] }, from peers' files
  const flush = async truth => {
    mkdirSync(run, { recursive: true })
    try {
      mkdirSync(lockDir)
    } catch {
      try {
        if (Date.now() - statSync(lockDir).mtimeMs < 60_000) return 'busy'
        rmSync(lockDir, { recursive: true, force: true })
        mkdirSync(lockDir)
      } catch {
        return 'busy'
      }
    }
    const t0 = Date.now()
    let store = null
    try {
      try {
        store = await timed(load(), 'load')
      } catch (e) {
        ok({}, { ok: false, error: `load: ${e.message}`, pending: pendingCount() })
        return 'load failed'
      }
      // 1. the ops, in order; a store error stops here and the rest wait
      let applied = 0
      for (;;) {
        const files = pending()
        if (!files.length) break
        for (const f of files) {
          const p = join(out, f)
          const op = readJson(p)
          if (!op || Date.now() - op.at > KEEP) {
            if (op) log({ kind: 'dropped', op })
            rmSync(p, { force: true })
            continue
          }
          try {
            await apply(store, op)
          } catch (e) {
            ok({}, { ok: false, error: `${op.op}: ${e.message}`, pending: pendingCount() })
            return 'store failed'
          }
          rmSync(p, { force: true })
          applied++
        }
      }
      // 2. liveness: the files say who lives; the store's leases follow
      const { live, queue } = truth()
      const mine = [...new Set([...live.values()].flat())]
      const { lost } = await timed(store.renew(mine, leaseMs), 'renew')
      for (const x of lost) log({ kind: 'lost', ...x })
      const own = h => h.startsWith(`${who}/`)
      for (const t of await timed(store.held(), 'held')) {
        // lapsed, or gone from the files (the sweep's dead claim): the files decide liveness in shadow
        const fl = live.get([...live.keys()].find(k => fold(k) === fold(t.id))) ?? []
        const lapsed = t.holders.filter(l => own(l.holder) && (l.expires < Date.now() || !fl.includes(l.holder))).map(l => l.holder)
        if (lapsed.length) await timed(store.release(t.id, `${who}/sweep`, { expire: lapsed, queue: true }), 'release')
      }
      // 3. the diff, this machine's holders and the queue
      const held = await timed(store.held(), 'held')
      const sLive = new Map()
      for (const t of held) {
        const hs = t.holders.filter(l => own(l.holder) && l.expires >= Date.now()).map(l => l.holder).sort()
        if (hs.length) sLive.set(fold(t.id), { id: t.id, hs })
      }
      const fLive = new Map([...live].map(([id, hs]) => [fold(id), { id, hs: [...hs].sort() }]))
      const now = []
      for (const k of new Set([...sLive.keys(), ...fLive.keys()])) {
        const f = fLive.get(k)?.hs ?? [], s = sLive.get(k)?.hs ?? []
        if (f.join() !== s.join()) now.push({ kind: 'holders', id: fLive.get(k)?.id ?? sLive.get(k).id, files: f, store: s })
      }
      // `run:<runner>` rows are aerie's (route puts, `aerie work` takes); queue.json never holds them: not ours to diff or fix
      const sItems = (await timed(store.queueList(), 'queueList')).filter(i => !String(i.pin ?? '').startsWith('run:'))
      const sq = sItems.map(i => [fold(i.id), i.lane, i.pin])
      const fq = queue.map(i => [fold(i.task), i.lane ?? null, i.pin ?? null])
      if (JSON.stringify(sq) !== JSON.stringify(fq)) now.push({ kind: 'queue', files: fq.map(x => x[0]), store: sq.map(x => x[0]) })
      // 4. seen twice: log and fix; seen once: wait a flush (an op may be in flight)
      const key = d => JSON.stringify(d)
      const last = new Set(readJson(lastPath, []))
      for (const d of now.filter(d => last.has(key(d)))) {
        log({ ...d, fixed: true })
        if (d.kind === 'holders') {
          for (const h of d.files.filter(h => !d.store.includes(h))) await timed(store.claim(d.id, h, leaseMs), 'claim')
          const extra = d.store.filter(h => !d.files.includes(h))
          if (extra.length) await timed(store.release(d.id, `${who}/sweep`, { expire: extra }), 'release')
        } else {
          await timed(store.queueRemove(sItems.map(i => i.id)), 'queueRemove')
          for (const i of queue) await timed(store.queueAdd([i.task], { lane: i.lane ?? undefined, pin: i.pin ?? undefined }), 'queueAdd')
        }
      }
      writeJson(lastPath, now.map(key))
      ok({}, { ok: true, error: null, pending: pendingCount(), applied, diffs: now.length, ms: Date.now() - t0 })
      return `ok: ${applied} ops, ${now.length} diffs`
    } catch (e) {
      ok({}, { ok: false, error: e.message, pending: pendingCount() })
      return `failed: ${e.message}`
    } finally {
      try {
        await store?.end?.()
      } catch {}
      rmSync(lockDir, { recursive: true, force: true })
    }
  }
  const pending = () => {
    try {
      return readdirSync(out).filter(f => f.endsWith('.json')).sort()
    } catch {
      return []
    }
  }
  const pendingCount = () => pending().length
  const apply = async (store, op) => {
    const id = op.id ?? ''
    if (op.op === 'claim') {
      await timed(store.claim(id, op.holder, leaseMs), 'claim')
    } else if (op.op === 'take') {
      const r = await timed(store.queueTake({ lanes: op.lanes, pin: op.pin ?? null }, op.holder, leaseMs), 'queueTake')
      if (fold(r?.id ?? '') !== fold(id)) log({ kind: 'take', files: id, store: r?.id ?? null })
    } else if (op.op === 'release') {
      const r = await timed(store.release(id, op.holder, op.o ?? {}), 'release')
      if (op.expect && r.status !== op.expect) log({ kind: 'release', id, files: op.expect, store: r.status })
    } else if (op.op === 'queueAdd') {
      await timed(store.queueAdd(op.ids, op.o ?? {}), 'queueAdd')
    } else if (op.op === 'queueRemove') {
      await timed(store.queueRemove(op.ids), 'queueRemove')
    }
  }
  const status = () => ({ store: config.coord, health: readJson(health), pending: pendingCount(), diffs: diffs })
  return { put, kick, warn, flush, status, diffs, store: load }
}
