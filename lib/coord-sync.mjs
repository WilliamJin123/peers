// Peers' files and the coord store named by config `coord` (Aerie D23). Two modes, config `coordMode`:
// shadow (WA-1370): the files are truth. A command writes an op file; a detached flush applies it; a diff seen on two
//   flushes is fixed in the store from the files.
// through (WA-1367.1, D23 B): the store is truth. A command calls the store under peers' board lock (≤ 2 s), then the
//   files follow. Store down, or ops still wait: the op file path as in shadow, replayed in order. The flush's diff
//   flips: the files follow the store.
// Both: the files decide which of this machine's sessions live (renew, release of the gone). The flush diffs and fixes
// only under the board lock with no op waiting, so it never reads a command half done.
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, appendFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileStore } from './coord-files.mjs'
import { statusesOf } from './board.mjs'
import { LANE } from './queue.mjs'

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
const alive = pid => {
  try {
    return !!pid && (process.kill(pid, 0), true)
  } catch (e) {
    return e.code === 'EPERM'
  }
}
// aerie's runner rows (route puts, `aerie work` takes): queue.json never holds them
const isRun = i => String(i.pin ?? '').startsWith('run:')

export const coordSync = ({ home, config: c0, who }) => {
  // PEERS_COORD, PEERS_COORD_MODE: the smokes' switches (scripts/smoke-coord-shadow.sh)
  const config = { ...c0, ...(process.env.PEERS_COORD ? { coord: process.env.PEERS_COORD } : {}), ...(process.env.PEERS_COORD_MODE ? { coordMode: process.env.PEERS_COORD_MODE } : {}) }
  if (!config.coord) return null
  const through = config.coordMode === 'through'
  const run = join(home, '.claude', 'peers-run')
  const out = join(run, 'coord-outbox')
  const health = join(run, 'coord-health.json')
  const diffs = join(run, 'coord-diff.jsonl')
  const lastPath = join(run, 'coord-last.json')
  const lockDir = join(run, 'coord-flush.lock')
  const listenPid = join(run, 'coord-listen.pid')
  // through: a lease outlives the 2 h dead-claim grace, so an outage under it loses no holder (D23)
  const leaseMs = (Number(config.coordLeaseSec) || (through ? 7200 : 300)) * 1000
  const ms = Number(config.coordTimeoutMs) || 2000
  // flush and listen run detached, and a fresh connect (~400 ms on prod) lands inside their first call: a wider limit
  const bgMs = Number(config.coordFlushTimeoutMs) || 5000
  let limit = ms
  const log = v => {
    mkdirSync(run, { recursive: true })
    appendFileSync(diffs, `${JSON.stringify({ at: Date.now(), ...v })}\n`)
  }
  const timed = (p, what) =>
    Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`${what}: no answer in ${limit} ms`)), limit).unref())])
  const load = async () => {
    if (config.coord === 'files') return fileStore({ dir: join(run, 'coord-files') })
    const p = isAbsolute(config.coord) ? config.coord : join(home, '.claude', 'peers', config.coord)
    const make = (await import(pathToFileURL(p).href)).default
    return make(config, who, { fileStore, statusesOf })
  }
  const pending = () => {
    try {
      return readdirSync(out).filter(f => f.endsWith('.json')).sort()
    } catch {
      return []
    }
  }
  const pendingCount = () => pending().length

  // An op file: applied by the flush, in name order.
  const put = op => {
    try {
      mkdirSync(out, { recursive: true })
      // µs wall clock: ops written under the board lock sort in lock order across processes
      writeFileSync(join(out, `${(performance.timeOrigin + performance.now()).toFixed(3).padStart(18, '0')}-${process.pid}.json`), JSON.stringify({ at: Date.now(), ...op }))
    } catch {}
  }
  // the flush runs apart from the command; through mode also keeps one listener up
  const kick = peersPath => {
    const go = args => {
      try {
        spawn(process.execPath, [peersPath, 'coord', ...args], { detached: true, stdio: 'ignore', env: process.env }).unref()
      } catch {}
    }
    go(['flush'])
    if (through && !alive(Number(readJson(listenPid)?.pid))) go(['listen'])
  }
  // one line on stderr per new error, from any command
  const warn = () => {
    const h = readJson(health)
    if (!h || h.ok || h.warned) return null
    try {
      writeJson(health, { ...h, warned: true })
    } catch {}
    return `peers: coord store (${config.coord}) failing: ${h.error}; peers runs on its files${through ? ' and replays to the store when it is back' : ', as before'}. \`peers coord\` shows more.`
  }
  const ok = v => {
    const was = readJson(health)
    // a new error warns again; the same error stays told
    const warned = !v.ok && was && !was.ok && was.error === v.error ? was.warned : false
    try {
      mkdirSync(run, { recursive: true })
      writeJson(health, { ...(v.ok ? {} : was ?? {}), ...v, warned, at: Date.now() })
    } catch {}
  }

  // through: the op on the store now, inside the command (its board lock held). The answer, or undefined: the caller
  // writes the op file (store down, or older ops wait: order holds).
  const send = async op => {
    if (!through || pending().length) return undefined
    let store = null
    try {
      store = await timed(load(), 'load')
      return (await apply(store, op)) ?? null
    } catch (e) {
      ok({ ok: false, error: `${op.op}: ${e.message}`, pending: pendingCount() })
      return undefined
    } finally {
      try {
        await store?.end?.()
      } catch {}
    }
  }

  // An op on the store. take: through mode keys it (a replay returns the lease the first try made) and returns the row.
  const apply = async (store, op) => {
    const id = op.id ?? ''
    if (op.op === 'claim') return timed(store.claim(id, op.holder, leaseMs), 'claim')
    if (op.op === 'take') {
      const rows = op.key ? await timed(store.queueList(), 'queueList') : []
      const r = await timed(store.queueTake({ lanes: op.lanes, pin: op.pin ?? null, ...(op.key ? { key: op.key } : {}) }, op.holder, leaseMs), 'queueTake')
      // a replay: the files took op.id offline. A different answer goes back, and op.id is claimed.
      if (op.replay && op.key && op.id && fold(r?.id ?? '') !== fold(op.id)) {
        log({ kind: 'take', files: op.id, store: r?.id ?? null, fixed: true })
        if (r) await timed(store.release(r.id, op.holder, { queue: true }), 'release')
        await timed(store.claim(op.id, op.holder, leaseMs), 'claim')
        return { id: op.id }
      }
      if (!op.key && fold(r?.id ?? '') !== fold(id)) log({ kind: 'take', files: id, store: r?.id ?? null })
      return r && { ...r, row: rows.find(i => fold(i.id) === fold(r.id)) ?? null }
    }
    if (op.op === 'release') {
      const r = await timed(store.release(id, op.holder, op.o ?? {}), 'release')
      if (op.expect && r.status !== op.expect) log({ kind: 'release', id, files: op.expect, store: r.status })
      return r
    }
    if (op.op === 'queueAdd') return timed(store.queueAdd(op.ids, op.o ?? {}), 'queueAdd')
    if (op.op === 'queueRemove') return timed(store.queueRemove(op.ids), 'queueRemove')
  }

  // files: { locked(f) (the board lock, null when busy), truth() → { live: Map task → ['who/holder'], queue },
  //          writeQueue(storeRows), drop(id, holder) }
  const flush = async files => {
    limit = bgMs
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
        ok({ ok: false, error: `load: ${e.message}`, pending: pendingCount() })
        return 'load failed'
      }
      // 1. the ops, in order; a store error stops here and the rest wait
      let applied = 0
      for (;;) {
        const fs = pending()
        if (!fs.length) break
        for (const f of fs) {
          const p = join(out, f)
          const op = readJson(p)
          if (!op || Date.now() - op.at > KEEP) {
            if (op) log({ kind: 'dropped', op })
            rmSync(p, { force: true })
            continue
          }
          try {
            await apply(store, { ...op, replay: true })
          } catch (e) {
            ok({ ok: false, error: `${op.op}: ${e.message}`, pending: pendingCount() })
            return 'store failed'
          }
          rmSync(p, { force: true })
          applied++
        }
      }
      // 2-4 under the board lock: no command is half done. Busy: the next flush diffs.
      const now = await files.locked(() => level(store, files))
      ok({ ok: true, error: null, pending: pendingCount(), applied, diffs: now?.length ?? null, ms: Date.now() - t0 })
      return `ok: ${applied} ops, ${now ? `${now.length} diffs` : 'board busy, no diff'}`
    } catch (e) {
      ok({ ok: false, error: e.message, pending: pendingCount() })
      return `failed: ${e.message}`
    } finally {
      try {
        await store?.end?.()
      } catch {}
      rmSync(lockDir, { recursive: true, force: true })
    }
  }

  const level = async (store, files) => {
    // an op written since step 1: it is not in the store yet, so a diff now is no miss
    if (pendingCount()) return []
    // 2. liveness: the files say who lives on this machine; the store's leases follow
    const { live, queue } = files.truth()
    const mine = [...new Set([...live.values()].flat())]
    const { lost } = await timed(store.renew(mine, leaseMs), 'renew')
    for (const x of lost) log({ kind: 'lost', ...x })
    const own = h => h.startsWith(`${who}/`)
    for (const t of await timed(store.held(), 'held')) {
      // lapsed, or gone from the files (the sweep's dead claim)
      const fl = live.get([...live.keys()].find(k => fold(k) === fold(t.id))) ?? []
      const gone = t.holders.filter(l => own(l.holder) && (l.expires < Date.now() || !fl.includes(l.holder))).map(l => l.holder)
      if (gone.length) await timed(store.release(t.id, `${who}/sweep`, { expire: gone, queue: true }), 'release')
    }
    // 3. the diff: this machine's holders and the queue
    const sLive = new Map()
    for (const t of await timed(store.held(), 'held')) {
      const hs = t.holders.filter(l => own(l.holder) && l.expires >= Date.now()).map(l => l.holder).sort()
      if (hs.length) sLive.set(fold(t.id), { id: t.id, hs })
    }
    const fLive = new Map([...live].map(([id, hs]) => [fold(id), { id, hs: [...hs].sort() }]))
    const now = []
    for (const k of new Set([...sLive.keys(), ...fLive.keys()])) {
      const f = fLive.get(k)?.hs ?? [], s = sLive.get(k)?.hs ?? []
      if (f.join() !== s.join()) now.push({ kind: 'holders', id: fLive.get(k)?.id ?? sLive.get(k).id, files: f, store: s })
    }
    const rows = (await timed(store.queueList(), 'queueList')).filter(i => !isRun(i))
    const sq = rows.map(i => [fold(i.id), i.lane ?? LANE, i.pin ?? null])
    const fq = queue.map(i => [fold(i.task), i.lane ?? LANE, i.pin ?? null])
    // through: the queue follows the store at once (other machines and aerie's route add to it)
    if (JSON.stringify(sq) !== JSON.stringify(fq)) {
      if (through) {
        files.writeQueue(rows)
        log({ kind: 'queue', files: fq.map(x => x[0]), store: sq.map(x => x[0]), pulled: true })
      } else now.push({ kind: 'queue', files: fq.map(x => x[0]), store: sq.map(x => x[0]) })
    }
    // 4. holders: seen on two flushes, a minute apart at least: log and fix
    const key = d => JSON.stringify(d)
    const last = readJson(lastPath, {})
    const seen = Array.isArray(last) ? {} : last // an old list: start over
    const next = {}
    for (const d of now) {
      const k = key(d)
      next[k] = seen[k] ?? Date.now()
      if (!(k in seen) || Date.now() - seen[k] < 60_000) continue
      delete next[k]
      log({ ...d, fixed: true })
      if (d.kind === 'holders') {
        const extra = d.store.filter(h => !d.files.includes(h))
        if (extra.length) await timed(store.release(d.id, `${who}/sweep`, { expire: extra }), 'release')
        for (const h of d.files.filter(h => !d.store.includes(h)))
          // through: the store let it go (a lapse past the grace): the files follow. shadow: the store follows.
          if (through) files.drop(d.id, h)
          else await timed(store.claim(d.id, h, leaseMs), 'claim')
      } else {
        await timed(store.queueRemove(rows.map(i => i.id)), 'queueRemove')
        for (const i of queue) await timed(store.queueAdd([i.task], { lane: i.lane ?? undefined, pin: i.pin ?? undefined }), 'queueAdd')
      }
    }
    writeJson(lastPath, next)
    return now
  }

  // through: the queue file follows each store change. One per machine; ends when the peers version changes or no
  // session runs (the mod's next kick starts it again).
  const listen = async ({ files, changed, running }) => {
    if (!through) return 'shadow mode: no listener'
    limit = bgMs
    mkdirSync(run, { recursive: true })
    const was = Number(readJson(listenPid)?.pid)
    if (was && was !== process.pid && alive(was)) return 'already listening'
    writeJson(listenPid, { pid: process.pid, at: Date.now() })
    const store = await timed(load(), 'load')
    if (!store.listen) {
      await store.end?.()
      return 'the store has no listen'
    }
    let t = null
    const pull = () =>
      files.locked(async () => {
        if (pendingCount()) return
        const rows = (await timed(store.queueList(), 'queueList')).filter(i => !isRun(i))
        files.writeQueue(rows)
      })
    // lease notices come on every renew of any machine: only queue changes rewrite the file
    const sub = await store.listen(what => {
      if (what !== 'queue') return
      clearTimeout(t)
      t = setTimeout(() => void pull().catch(e => ok({ ok: false, error: `listen: ${e.message}` })), 500)
    })
    await new Promise(done => {
      const tick = setInterval(() => {
        if (readJson(listenPid)?.pid !== process.pid || changed() || !running()) clearInterval(tick), done()
      }, 60_000)
    })
    clearTimeout(t)
    await sub.end().catch(() => {})
    await store.end?.()
    if (readJson(listenPid)?.pid === process.pid) rmSync(listenPid, { force: true })
    return 'listener ended'
  }

  const status = () => ({ store: config.coord, mode: through ? 'through' : 'shadow', health: readJson(health), pending: pendingCount(), diffs, listener: through ? alive(Number(readJson(listenPid)?.pid)) : null })
  return { through, put, send, kick, warn, flush, listen, status, diffs, store: load, key: () => randomUUID() }
}
