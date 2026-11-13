// The coordination port on files (WA-1369): the default store and the fallback. One JSON file per backing,
// each call under a mkdir lock (atomic across processes), each write tmp + rename. Rules: types/index.d.ts CoordStore.
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const WAIT = 2_000 // the port's 2 s bound
const STALE = 10_000 // a lock older than this: its process died mid-call
const sleep = ms => new Promise(r => setTimeout(r, ms))
const EMPTY = () => ({ v: 1, gen: 0, tasks: {}, queue: [] })

export const fileStore = ({ dir, now = Date.now }) => {
  const path = join(dir, 'coord.json')
  const lockDir = join(dir, 'coord.lock')
  const read = () => {
    try {
      return JSON.parse(readFileSync(path, 'utf8'))
    } catch {
      return EMPTY()
    }
  }
  const write = st => {
    const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
    writeFileSync(tmp, JSON.stringify(st))
    renameSync(tmp, path)
  }
  const locked = async f => {
    mkdirSync(dir, { recursive: true })
    const until = Date.now() + WAIT
    for (;;) {
      try {
        mkdirSync(lockDir)
        break
      } catch {
        try {
          if (Date.now() - statSync(lockDir).mtimeMs > STALE) rmSync(lockDir, { recursive: true, force: true })
        } catch {}
        if (Date.now() > until) throw new Error(`coord-files: lock busy over ${WAIT} ms (${lockDir})`)
        await sleep(5 + Math.random() * 10)
      }
    }
    try {
      const st = read()
      const before = JSON.stringify(st)
      const out = f(st)
      if (JSON.stringify(st) !== before) write(st)
      return out
    } finally {
      rmSync(lockDir, { recursive: true, force: true })
    }
  }
  const task = (st, id) => (st.tasks[id] ??= { leases: [], closing: [], updated: null })
  const live = l => l.expires >= now()
  const lease = (st, id, holder, leaseMs, queued) => {
    const t = task(st, id)
    const others = t.leases.filter(l => l.holder !== holder && live(l)).map(l => l.holder)
    const l = { holder, gen: ++st.gen, expires: now() + leaseMs, ...(queued ? { queued } : {}) }
    t.leases = [...t.leases.filter(x => x.holder !== holder), l]
    t.updated = now()
    return { gen: l.gen, others }
  }
  // the last-holder rule
  const drop = (st, id, holders, o = {}) => {
    const t = st.tasks[id]
    if (!t) return { last: true, closeNow: false, status: 'ready' }
    const gone = t.leases.filter(l => holders.includes(l.holder))
    t.leases = t.leases.filter(l => !holders.includes(l.holder))
    if (o.done && gone.some(l => l.holder === o.by)) t.closing.push({ holder: o.by, reason: o.done.reason, at: now() })
    t.updated = now()
    if (t.leases.length) return { last: false, closeNow: false, status: 'doing' }
    const closeNow = t.closing.length > 0
    delete st.tasks[id]
    if (closeNow) return { last: true, closeNow, status: 'done' }
    const q = o.queue && gone.find(l => l.queued)?.queued
    if (q) {
      st.queue = [{ id, lane: q.lane, pin: q.pin }, ...st.queue.filter(i => i.id !== id)]
      return { last: true, closeNow, status: 'queued' }
    }
    return { last: true, closeNow, status: 'ready' }
  }
  const mayTake = (i, o) => (i.pin ? !!o.pin && i.pin === o.pin : o.lanes === '*' || (Array.isArray(o.lanes) && o.lanes.includes(i.lane)))

  return {
    name: 'files',
    ownsStatus: false,
    // a queued id leaves the queue; its lease keeps the lane and pin, so a release with queue puts it back as it was
    claim: (id, holder, leaseMs) =>
      locked(st => {
        const item = st.queue.find(i => i.id === id)
        if (item) st.queue = st.queue.filter(i => i !== item)
        const had = st.tasks[id]?.leases.find(l => l.holder === holder)?.queued
        return { ...lease(st, id, holder, leaseMs, item ? { lane: item.lane, pin: item.pin } : had), title: null }
      }),
    renew: (holders, leaseMs) =>
      locked(st => {
        const lost = []
        for (const [id, t] of Object.entries(st.tasks))
          for (const l of t.leases.filter(l => holders.includes(l.holder)))
            if (live(l)) l.expires = now() + leaseMs
            else lost.push({ id, holder: l.holder })
        for (const x of lost) drop(st, x.id, [x.holder], { queue: !!st.tasks[x.id]?.leases.find(l => l.holder === x.holder)?.queued })
        return { lost }
      }),
    release: (id, holder, o = {}) => locked(st => drop(st, id, [holder, ...(o.expire ?? [])], { ...o, by: holder })),
    held: () =>
      locked(st =>
        Object.entries(st.tasks).map(([id, t]) => ({ id, title: null, holders: t.leases.map(l => ({ ...l })), updated: t.updated, closing: t.closing.map(x => ({ ...x })) })),
      ),
    queueAdd: (ids, o = {}) =>
      locked(st => {
        const items = ids.map(id => ({ id, lane: o.lane ?? null, pin: o.pin ?? null }))
        let rest = st.queue.filter(i => !ids.includes(i.id))
        const at = o.at ?? 'end'
        if (at === 'top') rest = [...items, ...rest]
        else if (at === 'end') rest = [...rest, ...items]
        else {
          const k = rest.findIndex(i => i.id === at.after)
          if (k < 0) throw new Error(`${at.after} is not queued`)
          rest = [...rest.slice(0, k + 1), ...items, ...rest.slice(k + 1)]
        }
        st.queue = rest
      }),
    queueRemove: ids => locked(st => void (st.queue = st.queue.filter(i => !ids.includes(i.id)))),
    queueList: () => locked(st => st.queue.map((i, pos) => ({ ...i, pos }))),
    // o.key: a replay of a take this holder made returns its lease while it lives
    queueTake: (o, holder, leaseMs) =>
      locked(st => {
        if (o.key)
          for (const [id, t] of Object.entries(st.tasks)) {
            const l = t.leases.find(l => l.holder === holder && l.key === o.key && live(l))
            if (l) return { id, gen: l.gen }
          }
        const item = st.queue.find(i => mayTake(i, o))
        if (!item) return null
        st.queue = st.queue.filter(i => i !== item)
        const r = lease(st, item.id, holder, leaseMs, { lane: item.lane, pin: item.pin })
        if (o.key) st.tasks[item.id].leases.find(l => l.holder === holder).key = o.key
        return { id: item.id, gen: r.gen }
      }),
    fence: (id, holder, gen) => locked(st => !!st.tasks[id]?.leases.some(l => l.holder === holder && l.gen === gen && live(l))),
  }
}
