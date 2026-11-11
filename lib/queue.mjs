// The work queue (designs/2026-11-11-work-queue.md): one ordered list of tasks, each with a lane and an optional pin.
// Files under the claims folder, written only by the CLI under the board lock (tmp, then rename):
//   queue.json            { items: [{ task, title, lane, pin, by, at }] }, the order is the array
//   serve/<session>.json  { session, lanes }: lanes a list, or '*' for every lane
// Pure: the mod imports it too (no Node there). Files: lib/queue-files.mjs.
// A claim taken from the queue carries `queued: { item, id, told }`: told false until the mod's prompt entered.
export const LANE = 'main'
const fold = s => String(s ?? '').toLowerCase()
export const same = (a, b) => fold(a) === fold(b)

// item into items: --top, --after <id>, else last. A task already queued moves.
export const place = (items, item, { top = false, after = null } = {}) => {
  const rest = items.filter(i => !same(i.task, item.task))
  if (top) return [item, ...rest]
  if (after) {
    const k = rest.findIndex(i => same(i.task, after))
    if (k < 0) throw new Error(`${after} is not queued`)
    return [...rest.slice(0, k + 1), item, ...rest.slice(k + 1)]
  }
  return [...rest, item]
}
export const serves = (lanes, lane) => lanes === '*' || (Array.isArray(lanes) && lanes.includes(lane))
// A pin is an exact /rename name; it reaches that session whether it serves or not.
export const mayTake = (item, name, lanes) => (item.pin ? !!name && item.pin === name : serves(lanes, item.lane))
export const pick = (items, name, lanes) => items.find(i => mayTake(i, name, lanes)) ?? null
export const deliveryId = item => `q-${item.task}-${item.at}`
export const labelsOf = item => ['queued', `lane:${item.lane}`, ...(item.pin ? [`pin:${item.pin.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`] : [])]
export const isQueueLabel = l => l === 'queued' || l.startsWith('lane:') || l.startsWith('pin:')
// What the mod submits; the id lets a restarted mod find it in its transcript.
export const promptOf = q =>
  `[peers work queue ${q.id}] ${q.item.task}${q.item.title ? `: ${q.item.title}` : ''}. Queued by ${q.item.by ?? 'a session'}, lane ${q.item.lane}${q.item.pin ? `, pinned to you` : ''}. ` +
  `You hold it now. Read it (backlog task view ${q.item.task} --plain) and do it. If you already have this task, ignore this.`
// The session may take queued work now: idle (the session file), no question or permission waits, quiet for quietMs.
export const quiet = (st, now, quietMs) => !!st && st.status === 'idle' && !st.waitingFor && now - (st.statusAt ?? now) >= quietMs
// `peers queue`: one line per item, then a line per lane no live session serves and per pin not running.
export const queueLines = (items, serving, names, running) => {
  const live = [...serving].filter(([s]) => !running || running.has(s))
  const byLane = lane => live.filter(([, l]) => serves(l, lane)).map(([s]) => names.get(s) ?? s.slice(0, 8))
  const runningNames = new Set([...(running ?? [])].map(s => names.get(s)).filter(Boolean))
  const lines = items.map((i, n) => {
    const to = i.pin ? `for ${i.pin}${runningNames.has(i.pin) ? '' : ' (not running: waits)'}` : (() => {
      const who = byLane(i.lane)
      return who.length ? `served by ${who.join(', ')}` : 'no live session serves this lane'
    })()
    return `${String(n + 1).padStart(2)}. ${i.task}  [${i.lane}]  ${to}  ${i.title ?? ''}`.trimEnd()
  })
  return lines
}
