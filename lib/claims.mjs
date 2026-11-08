// Claims: who holds which task. One file per session, `~/.claude/peers-claims/<session>.json`, written by the CLI alone,
// under the board lock: { v, session, agent, ticket, title, claimed, updated, name }. One file = one task per session.
// The ledgers (the mod's, per repo) give only liveness. A board shows the claims (status + holder mark), the sweep repairs it.
// Many machines, one board: a holder is `<who>/<session name>`, who = person@machine. Each machine writes only its own
// holders and reads the rest: one writer per holder, so every machine's sweep converges, whatever the board's lag.
// Pure: no board, no fs.
import { idOf, LIVE_MS } from './core.mjs'

// In core.mjs: the mod reads claims too, and core must not import this file.
export { CLAIMS, overlay } from './core.mjs'

// This machine's name on boards: config `who`, else user@host. Set once: a holder under an old who is another machine's.
const slug = x => String(x ?? '').toLowerCase().replace(/[^a-z0-9.@_-]+/g, '-').replace(/^-|-$/g, '')
export const whoOf = (config, user, host) => slug(config?.who) || `${slug(user)}@${slug(String(host).split('.')[0])}`
// Holders this machine writes. One with no `/` is from before 0.22.0, when one machine wrote them all.
export const ownBy = who => h => !h.includes('/') || h.startsWith(`${who}/`)
// GitHub and Jira keep holders as comments, a log no one rewrites: replayed in order, it gives who holds the issue now.
export const holdsText = h => `peers: ${h} holds this`
export const letGoText = h => `peers: ${h} lets go`
export const QUEUE_TEXT = 'peers: back to the queue, no session holds it'
export const replay = bodies => {
  const on = new Set()
  for (const b of bodies) {
    const line = String(b ?? '').trim().split('\n')[0].trim()
    let m
    if ((m = /^peers: (.+?) holds? this$/.exec(line))) for (const h of m[1].split(', ')) on.add(h)
    else if ((m = /^peers: (.+?) lets go$/.exec(line))) on.delete(m[1])
    else if (line.startsWith('peers: back to the queue') || line.startsWith('Done: ')) on.clear()
  }
  return [...on].sort()
}
// A board assignee peers owns: `@peers:<holder>`. Every other assignee is the board's own and stays.
export const MARK = '@peers:'
export const marked = a => typeof a === 'string' && a.startsWith(MARK)
export const theirs = as => (as ?? []).filter(a => !marked(a))
// The name a board shows: the /rename name with the id. A closed session is off the running list: the name kept at claim.
export const holderName = (c, names) => {
  const id = idOf(c)
  const given = names?.get(c.session)
  const slug = given?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return slug ? `${slug}-${id.split('-').pop()}` : c.name ?? id
}
// A closed or crashed session may come back (/resume): its claim holds for GRACE after its last write.
export const GRACE = 2 * 60 * 60 * 1000

// session -> its latest ledger write in any repo: { updated, ended, agent }.
export const activity = ledgers => {
  const out = new Map()
  for (const l of ledgers) {
    if (!l?.session) continue
    const b = out.get(l.session)
    if (!b || (l.updated ?? 0) > b.updated) out.set(l.session, { updated: l.updated ?? 0, ended: l.ended ?? null, agent: l.agent })
  }
  return out
}
const last = (c, a) => Math.max(c.updated ?? 0, a?.updated ?? 0)
// Open: in the running list, however long idle (isLive's 12 h edit window would drop a claim of an open session).
// Other agents are not on the list: the edit window and the end mark.
export const open = (c, a, now, running) => {
  const agent = c.agent ?? a?.agent
  if (running && (!agent || agent === 'claude')) return running.has(c.session)
  return now - last(c, a) < LIVE_MS && !(a?.ended && a.ended >= (c.updated ?? 0))
}
export const claimLive = (c, a, now, running) => !!c?.ticket && (open(c, a, now, running) || now - last(c, a) < GRACE)

// Other sessions whose claim on ticket holds now: `peers close` waits for them.
export const holdersOf = (claims, ledgers, ticket, now, running, except) => {
  const act = activity(ledgers)
  return claims.filter(c => c.session !== except && c.ticket === ticket && claimLive(c, act.get(c.session), now, running))
}
// live: ticket -> sorted holder names. dead: the claims past their grace, for the sweep to free and then delete.
export const claimsOf = (claims, ledgers, now, running, names, who = '') => {
  const act = activity(ledgers)
  const live = new Map(), dead = []
  for (const c of claims) {
    if (!c?.ticket) continue
    if (claimLive(c, act.get(c.session), now, running)) live.set(c.ticket, [...(live.get(c.ticket) ?? []), (who ? `${who}/` : '') + holderName(c, names)].sort())
    else dead.push(c)
  }
  return { live, dead }
}

// held: the board's In Progress, [{ id, title, holders }]: every machine's holders, null where the board shows none.
// covers: the ids that board lists at all (GitHub: one repo's issues).
// Out: board writes, lines for the person, and the dead claims to delete. This machine changes only its own holders.
// release queue: back to To Do, only when no other machine holds it; else this machine's holders go and the task stays.
// A dead claim frees its task once (a person who sets it In Progress again keeps it); while another machine still holds
// the task it stays, so the last one out sends it back even when two machines let go at once.
export const plan = (held, { live, dead }, covers = () => true, who = '') => {
  const own = ownBy(who)
  const writes = [], hand = [], off = [], keep = new Set()
  const mine = dead.filter(c => covers(c.ticket))
  const gone = new Set(mine.map(c => c.ticket))
  const on = new Set(held.map(t => t.id))
  for (const t of held) {
    const want = live.get(t.id)
    const hs = t.holders
    const ours = hs ? hs.filter(own).sort() : null
    const others = hs ? hs.filter(h => !own(h)) : []
    if (want) {
      if (hs && ours.join() !== want.join()) writes.push({ call: 'hold', ticket: t.id, holders: want })
    } else if (others.length) {
      if (ours.length) writes.push({ call: 'release', ticket: t.id, queue: false })
      if (gone.has(t.id)) keep.add(t.id)
    } else if (ours?.length || gone.has(t.id)) writes.push({ call: 'release', ticket: t.id, queue: true })
    else hand.push(t.id)
  }
  for (const [id, h] of live) if (!on.has(id) && covers(id)) off.push(`${id} (${h.join(', ')})`)
  const notes = []
  if (hand.length) notes.push(`In Progress, no session holds it (set by hand? the sweep leaves it): ${hand.join(', ')}`)
  if (off.length) notes.push(`Held, but not In Progress on the board: ${off.join(', ')}`)
  return { writes, notes, dead: mine.filter(c => !keep.has(c.ticket)) }
}
// Other machines' and people's holds, from the board: `peers held`.
export const awayLines = (held, who) =>
  held.flatMap(t => (t.holders ?? []).filter(h => !ownBy(who)(h)).map(h => `${t.id}  ${h}  (another machine)  ${t.title ?? ''}`.trimEnd()))

// 0.20 kept claims in the ledgers: each session's latest one becomes its claim file, once.
export const fromLedgers = ledgers => {
  const best = new Map()
  for (const l of ledgers) {
    if (!l?.ticket || !l.claimed || !l.session) continue
    const b = best.get(l.session)
    if (!b || l.claimed > b.claimed) best.set(l.session, l)
  }
  return [...best.values()].map(l => ({ v: 1, session: l.session, agent: l.agent, ticket: l.ticket, title: l.title ?? null, claimed: l.claimed, updated: l.updated ?? l.claimed }))
}

// One line per held task: `peers held`, the end of `peers ready`.
const ago = ms => (ms < 3600e3 ? `${Math.max(0, Math.round(ms / 60e3))}m` : ms < 86400e3 ? `${Math.round(ms / 3600e3)}h` : `${Math.round(ms / 86400e3)}d`)
export const heldLines = (claims, ledgers, now, running, names) => {
  const act = activity(ledgers)
  const by = new Map()
  for (const c of claims) {
    const a = act.get(c.session)
    if (!claimLive(c, a, now, running)) continue
    const up = open(c, a, now, running)
    const seen = last(c, a)
    by.set(c.ticket, [...(by.get(c.ticket) ?? []), `${c.ticket}  ${holderName(c, names)}${up ? '' : ` (closed, frees in ${ago(GRACE - (now - seen))})`}  claimed ${ago(now - c.claimed)} ago, active ${ago(now - seen)} ago  ${c.title ?? ''}`.trimEnd()])
  }
  return [...by].sort(([a], [b]) => a.localeCompare(b)).flatMap(([, rows]) => rows)
}
