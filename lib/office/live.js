// Live feed: the view server's /events (sig only) → /api/index → the office model, and events from each change.
// The first read and a read after a gap set the scene with no events; at most 3 edit/commit events per session per read.
import { colorRule } from '../lib/rows.mjs'
import { createModel, statusOf } from './model.js'

const DONE_KEEP = 6, BURST = 3

export function createLive({ only = [] } = {}) {
  const m = createModel('live')
  const q = only.map((t) => `only=${encodeURIComponent(t)}`).join('&')
  let sig = null, first = true, pulling = null, again = false
  const seen = new Map() // session → newest feed time seen
  const pair = new Map() // key → author count, for clash events
  const done = new Map() // ticket → Done task (dropped by a session still here)
  const files = new Map() // key → { root, rel, size, adds, dels, authors, changes }
  const roomOrder = [] // room ids by first sight: rooms keep their place

  const setStatus = (s) => { if (m.status !== s) { m.status = s; m.emit({ type: 'status' }) } }

  async function pull() {
    if (pulling) { again = true; return pulling }
    pulling = (async () => {
      try {
        do {
          again = false
          const r = await fetch(`/api/index?${q}${sig ? `${q ? '&' : ''}sig=${sig}` : ''}`, { cache: 'no-store' })
          if (r.status === 204) { setStatus('live'); continue }
          if (!r.ok) throw new Error(`index ${r.status}`)
          const ix = await r.json()
          sig = ix.sig
          apply(ix)
          setStatus('live')
        } while (again)
      } catch { setStatus('offline') }
      pulling = null
    })()
    return pulling
  }

  function apply(ix) {
    const events = []
    const color = colorRule(ix.repos.flatMap((r) => r.sessions), ix.order)
    // shown name: the folder; two roots with one name show their parent too
    const dup = new Set(ix.repos.map((r) => r.name).filter((n, i, a) => a.indexOf(n) !== i))
    const rid = (r) => (dup.has(r.name) ? r.root.split('/').slice(-2).join('/') : r.name)
    const next = new Map()
    files.clear()
    for (const r of ix.repos) {
      const id = rid(r)
      if (!roomOrder.includes(id)) roomOrder.push(id)
      const held = new Map() // session → Map(key → lines)
      for (const f of r.files) {
        const key = `${id}/${f.rel}`
        files.set(key, { root: r.root, rel: f.rel, size: f.size ?? 0, adds: f.adds ?? 0, dels: f.dels ?? 0, authors: f.authors, changes: f.changes ?? [], kind: f.kind })
        for (const a of f.authors) { if (!held.has(a)) held.set(a, new Map()); held.get(a).set(key, Math.max(1, (f.adds ?? 0) + (f.dels ?? 0))) }
        if (!first && f.authors.length > 1 && (pair.get(key) ?? 0) < 2) events.push({ type: 'clash', who: f.authors[f.authors.length - 1], other: f.authors[0], key })
        pair.set(key, f.authors.length)
      }
      for (const s of r.sessions) {
        const holds = held.get(s.id) ?? new Map()
        const lastEdit = r.feed.find((x) => x.a === s.id && x.kind === 'edit')
        const prev = next.get(s.id)
        // a session in two repos sits in the one where it holds more
        if (prev && prev.holds.size >= holds.size) { for (const [k, v] of holds) prev.holds.set(k, v); continue }
        if (prev) for (const [k, v] of prev.holds) holds.set(k, v)
        next.set(s.id, {
          id: s.id, name: s.label || s.name, short: s.name, color: color(s.id), repo: id,
          state: s.waitingFor ? 'blocked' : s.status && s.status !== 'idle' ? 'work' : 'idle',
          why: s.waitingFor || null, closed: !s.status, holds,
          focus: lastEdit ? `${id}/${lastEdit.rels[0]}` : null,
          taskId: s.ticket || null, task: s.ticket ? s.title || '' : '', about: s.ticket ? null : s.title,
          commits: s.commitCount ?? 0, shas: (s.commits ?? []).slice(0, 5).map((c) => c.sha.slice(0, 7)), doing: s.doing,
        })
      }
      // new edits and commits since the last read, oldest first
      if (!first) {
        const per = new Map()
        for (const x of [...r.feed].reverse()) {
          // a session not seen before: its history is not news
          if (x.at <= (seen.has(x.a) ? seen.get(x.a) : m.byId[x.a] ? 0 : Infinity)) continue
          const n = (per.get(x.a) ?? 0) + 1
          per.set(x.a, n)
          if (n > BURST) continue
          const keys = x.rels.map((rel) => `${id}/${rel}`)
          if (x.kind === 'edit') { const f = files.get(keys[0]); events.push({ type: 'edit', who: x.a, key: keys[0], add: f?.adds ?? 0, rem: f?.dels ?? 0 }) }
          else events.push({ type: 'commit', who: x.a, keys, sha: x.sha, msg: x.t, task: next.get(x.a)?.taskId ?? null })
        }
      }
      for (const x of r.feed) if (x.at > (seen.get(x.a) ?? 0)) seen.set(x.a, x.at)
    }

    // sessions: keep each object (the scene holds it), change its fields
    for (const [id, n] of next) {
      const was = m.byId[id]
      if (!was) { m.byId[id] = n; if (!first) events.unshift({ type: 'join', who: id }); continue }
      if (!first && was.state !== n.state) events.push({ type: 'state', who: id, state: n.state, why: n.why })
      if (!first && was.taskId !== n.taskId) {
        if (was.taskId) { events.push({ type: 'close', who: id, id: was.taskId, task: was.task }); done.set(was.taskId, m.taskById[was.taskId] ?? { id: was.taskId, title: was.task, repo: was.repo, files: new Set(), commits: [] }) }
        if (n.taskId) { done.delete(n.taskId); events.push({ type: 'claim', who: id, id: n.taskId, task: n.task }) }
      }
      Object.assign(was, n)
    }
    for (const id of Object.keys(m.byId)) if (!next.has(id)) { if (!first) events.push({ type: 'leave', who: id }); delete m.byId[id] }
    m.sessions = [...next.keys()].map((id) => m.byId[id])
    m.repos = roomOrder.filter((id) => m.sessions.some((x) => x.repo === id)).map((id) => ({ id, name: id }))
    roomOrder.splice(0, roomOrder.length, ...roomOrder.filter((id) => m.repos.some((r) => r.id === id)))

    // tasks: one per held ticket; Done ones this page saw closed
    const tasks = new Map()
    for (const x of m.sessions) {
      if (!x.taskId) continue
      const t = tasks.get(x.taskId) ?? m.taskById[x.taskId] ?? { id: x.taskId }
      if (!tasks.has(x.taskId)) Object.assign(t, { title: x.task, repo: x.repo, holders: [], files: new Set(), commits: [] })
      t.holders.push(x.id)
      for (const k of x.holds.keys()) t.files.add(k)
      t.commits.push(...x.shas)
      tasks.set(x.taskId, t)
    }
    for (const t of tasks.values()) t.status = statusOf(t, m.byId)
    // still held by another session: not done
    for (const id of done.keys()) if (tasks.has(id)) done.delete(id)
    for (const id of [...done.keys()].slice(0, -DONE_KEEP)) done.delete(id)
    for (const t of done.values()) Object.assign(t, { holders: [], status: 'Done' })
    m.tasks = [...tasks.values(), ...done.values()]
    m.taskById = Object.fromEntries(m.tasks.map((t) => [t.id, t]))
    m.only = ix.only ? { asked: ix.only, live: ix.live } : null

    first = false
    for (const e of events) m.emit(e)
    m.emit({ type: 'sync' })
  }

  m.fileInfo = (key) => {
    const f = files.get(key)
    return f && { lines: f.size, adds: f.adds, dels: f.dels, holders: f.authors, kind: f.kind, edits: f.changes.map((c) => ({ who: c.a, add: c.adds, rem: c.dels, at: c.line, t: c.t })) }
  }
  // the file's hunks, numbered, each line with its author
  m.diff = async (key) => {
    const f = files.get(key)
    if (!f) return null
    const r = await fetch(`/api/hunks?root=${encodeURIComponent(f.root)}&rel=${encodeURIComponent(f.rel)}`, { cache: 'no-store' }).catch(() => null)
    if (!r?.ok) return null
    const hunks = await r.json()
    return (hunks ?? []).map((h) => {
      let o = h.old, n = h.new
      return { at: h.t || h.at, who: h.a, lines: h.lines.map((x) => ({ t: x.t, s: x.s, a: x.a, at: x.at, o: x.t === '+' ? null : o++, n: x.t === '-' ? null : n++ })) }
    })
  }

  const es = new EventSource(`/events?sig=1${q ? `&${q}` : ''}`)
  es.onopen = () => pull() // a reconnect: one read, and live again even when nothing changed
  es.onmessage = () => pull()
  es.onerror = () => setStatus(es.readyState === EventSource.CLOSED ? 'offline' : 'connecting')
  // back from a sleep or a hidden tab: one read, no replay of what passed
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pull() })
  m.ready = pull()
  return m
}
