// Claims: the ledgers are the one truth for who holds a task. A board shows it (status + holder mark), peers writes it,
// the sweep repairs it. Pure: no board, no fs. bin/peers.mjs feeds it the ledgers and the board's In Progress list.
import { idOf, LIVE_MS } from './core.mjs'

// A board assignee peers owns: `@peers:<name>`. Every other assignee is the board's own and stays.
export const MARK = '@peers:'
export const marked = a => typeof a === 'string' && a.startsWith(MARK)
export const theirs = as => (as ?? []).filter(a => !marked(a))
// The name a board shows: the /rename name with the id, else the id. Same set as the band.
export const holderName = (l, names) => {
  const id = idOf(l)
  const given = names?.get(l.session)
  const slug = given?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return slug ? `${slug}-${id.split('-').pop()}` : id
}
// A closed or crashed session may come back (/resume): its claim holds for GRACE after its last write.
export const GRACE = 2 * 60 * 60 * 1000
// Open: in the running list, however long idle (isLive's 12 h edit window would drop a claim of an open session).
export const open = (l, now, running) =>
  running && (!l.agent || l.agent === 'claude') ? running.has(l.session) : now - (l.updated ?? 0) < LIVE_MS && !l.ended
export const claimLive = (l, now, running) => !!l?.ticket && (open(l, now, running) || now - (l.updated ?? 0) < GRACE)

// A session holds one task: its latest claim. It has a ledger per repo, and before 0.20.0 a claim left the old
// ticket in the others. [current, superseded]: one ledger per session, and the ledgers whose ticket a later claim replaced.
const at = l => [l.claimed ?? 0, l.updated ?? 0]
export const current = ledgers => {
  const best = new Map()
  for (const l of ledgers) {
    if (!l?.ticket) continue
    const b = best.get(l.session)
    if (!b || at(l)[0] > at(b)[0] || (at(l)[0] === at(b)[0] && at(l)[1] > at(b)[1])) best.set(l.session, l)
  }
  const keep = new Set(best.values())
  return [[...keep], ledgers.filter(l => l?.ticket && !keep.has(l))]
}
// ticket -> sorted holder names (live claims), and the tickets only dead or replaced claims name.
export const claimsOf = (ledgers, now, running, names) => {
  const live = new Map(), dead = new Set()
  const [now1, old] = current(ledgers)
  for (const l of now1) {
    if (claimLive(l, now, running)) live.set(l.ticket, [...(live.get(l.ticket) ?? []), holderName(l, names)].sort())
    else dead.add(l.ticket)
  }
  for (const l of old) dead.add(l.ticket)
  for (const t of live.keys()) dead.delete(t)
  return { live, dead }
}

// held: the board's In Progress, [{ id, title, holders }]; holders null where the board keeps no marks (GitHub, Jira).
// Out: board writes (hold, release) and lines for the person. A task no claim ever named is the person's: report only.
export const plan = (held, { live, dead }) => {
  const writes = [], notes = []
  const on = new Set(held.map(t => t.id))
  for (const t of held) {
    const want = live.get(t.id)
    if (want) {
      if (t.holders && t.holders.slice().sort().join() !== want.join()) writes.push({ call: 'hold', id: t.id, holders: want })
    } else if (t.holders?.length || dead.has(t.id)) writes.push({ call: 'release', id: t.id })
    else notes.push(`${t.id} is In Progress, and no session holds it (set by hand?)`)
  }
  for (const [id, who] of live) if (!on.has(id)) notes.push(`${id}: ${who.join(', ')} ${who.length > 1 ? 'hold' : 'holds'} it, and the board does not show it In Progress`)
  return { writes, notes }
}

// One line per held task, from the ledgers alone: `peers held`, the end of `peers ready`.
const ago = ms => (ms < 3600e3 ? `${Math.max(0, Math.round(ms / 60e3))}m` : ms < 86400e3 ? `${Math.round(ms / 3600e3)}h` : `${Math.round(ms / 86400e3)}d`)
export const heldLines = (ledgers, now, running, names) => {
  const by = new Map()
  // Active: the session's last write in any repo.
  const last = new Map()
  for (const l of ledgers) if (l?.session) last.set(l.session, Math.max(last.get(l.session) ?? 0, l.updated ?? 0))
  for (const l of current(ledgers)[0]) {
    if (!claimLive(l, now, running)) continue
    by.set(l.ticket, [...(by.get(l.ticket) ?? []), { name: holderName(l, names), last: last.get(l.session), claimed: l.claimed ?? null, title: l.title ?? '', up: open(l, now, running) }])
  }
  return [...by].sort(([a], [b]) => a.localeCompare(b)).flatMap(([t, rows]) =>
    rows.map(r => `${t}  ${r.name}${r.up ? '' : ' (closed, holds for 2h)'}  ${r.claimed ? `claimed ${ago(now - r.claimed)} ago, ` : ''}active ${ago(now - r.last)} ago  ${r.title}`.trimEnd()),
  )
}
