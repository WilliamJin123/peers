// Synthetic peers feed: same shape the live view will read from ledgers + acts.
// Seeded, so every sample plays the same story.

export const REPOS = [
  { id: 'wren', dirs: ['packages/variants', 'packages/portal', 'db', 'scripts'] },
  { id: 'peers', dirs: ['lib', 'bin', 'hooks'] },
  { id: 'vireo', dirs: ['src', 'drizzle'] },
  { id: 'engine', dirs: ['birdwatch', 'read'] },
]

const FILES = {
  'packages/variants': ['store.ts', 'collect.ts', 'live-page.tsx', 'batch.ts'],
  'packages/portal': ['shell.tsx', 'chat.tsx', 'nav.tsx'],
  db: ['schema.ts', 'migrate.ts'],
  scripts: ['push.sh', 'gates.sh'],
  lib: ['core.mjs', 'lines.mjs', 'hook.mjs'],
  bin: ['peers.mjs'],
  hooks: ['register.tsx'],
  src: ['index.ts', 'stats.ts', 'cli.ts'],
  drizzle: ['0007_ships.sql'],
  birdwatch: ['brief.ts', 'follow.ts', 'cli.ts'],
  read: ['ladder.ts', 'video.ts'],
}

export const SESSIONS = [
  { id: 'cc-3381', name: 'wren work', color: '#6a9bcc', repo: 'wren', task: 'Vireo chat agent' },
  { id: 'cc-b997', name: 'portal ui', color: '#4f9a94', repo: 'wren', task: 'Shell side chat' },
  { id: 'cc-85d6', name: 'peers dev', color: '#788c5d', repo: 'peers', task: 'Ledger size cap' },
  { id: 'cc-cfdb', name: 'devsite', color: '#c46686', repo: 'vireo', task: 'Hero batch 5' },
  { id: 'cc-7a10', name: 'birdwatch dev', color: '#b0a04a', repo: 'engine', task: 'Follow by person' },
  { id: 'cc-e2c4', name: 'runs', color: '#8a7fc0', repo: 'engine', task: 'Dogfood run triage' },
]

export const files = (repo) => {
  const r = REPOS.find((x) => x.id === repo)
  return r.dirs.flatMap((d) => FILES[d].map((f) => `${d}/${f}`))
}

const LINES = [
  'can you leave store.ts to me?', 'pushed, CI green', 'drizzle files are yours',
  'blocked on your migration', 'taking lines 40-80', 'rebased on main', 'ok, all yours',
]
const COMMITS = ['fix race in collect', 'add ship ledger', 'cap ledger size', 'side chat skeleton', 'follow --as posts', 'batch 5 tones', 'triage round 2']

function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// states: work | idle | blocked (needs William) | wait (on a peer)
export function createSim({ seed = 7, tickMs } = {}) {
  const q = new URLSearchParams(location.search)
  const speed = Number(q.get('speed') || 1)
  const r = rng(seed)
  const pick = (a) => a[Math.floor(r() * a.length)]
  const subs = new Set()
  const log = []
  const s = SESSIONS.map((x) => ({ ...x, state: 'work', since: 0, holds: new Map(), focus: null, commits: 0 }))
  const byId = Object.fromEntries(s.map((x) => [x.id, x]))
  let t = 0
  let sha = 0x3a91c

  const emit = (e) => {
    e.t = t
    log.push(e)
    if (log.length > 200) log.shift()
    for (const f of subs) f(e)
  }
  const setState = (x, st, extra = {}) => {
    if (x.state === st) return
    x.state = st
    x.since = t
    emit({ type: 'state', who: x.id, state: st, ...extra })
  }
  const holderOf = (repo, file) => s.find((y) => y.repo === repo && y.holds.has(file))

  // opening scene: everyone holds a few files
  for (const x of s) {
    const fs = files(x.repo)
    for (let i = 0; i < 2; i++) {
      const f = pick(fs)
      if (!holderOf(x.repo, f)) x.holds.set(f, 5 + Math.floor(r() * 30))
    }
  }

  function step() {
    t++
    for (const x of s) {
      const age = t - x.since
      if (x.state === 'blocked') {
        if (age > 9 && r() < 0.25) setState(x, 'work')
        continue
      }
      if (x.state === 'wait') {
        if (age > 6 && r() < 0.3) setState(x, 'work')
        continue
      }
      if (x.state === 'idle') {
        if (age > 5 && r() < 0.2) {
          setState(x, 'work')
          emit({ type: 'claim', who: x.id, task: x.task })
        }
        continue
      }
      const roll = r()
      if (roll < 0.42) {
        // edit a held file, or take a new one
        const fs = files(x.repo)
        let f = x.holds.size && r() < 0.65 ? pick([...x.holds.keys()]) : pick(fs)
        const other = holderOf(x.repo, f)
        if (other && other !== x) {
          emit({ type: 'clash', who: x.id, other: other.id, file: f, repo: x.repo })
          if (r() < 0.5) setState(x, 'wait', { on: other.id })
          continue
        }
        const add = 1 + Math.floor(r() * 18)
        const rem = Math.floor(r() * 8)
        if (!x.holds.has(f)) emit({ type: 'take', who: x.id, file: f, repo: x.repo })
        x.holds.set(f, (x.holds.get(f) || 0) + add + rem)
        x.focus = f
        emit({ type: 'edit', who: x.id, file: f, repo: x.repo, add, rem })
      } else if (roll < 0.5 && x.holds.size >= 2) {
        const fs = [...x.holds.keys()]
        x.holds.clear()
        x.focus = null
        x.commits++
        sha += 0x1f3 + Math.floor(r() * 0xfff)
        emit({ type: 'commit', who: x.id, files: fs, repo: x.repo, sha: sha.toString(16).slice(-7), msg: pick(COMMITS) })
      } else if (roll < 0.58) {
        const to = pick(s.filter((y) => y !== x))
        emit({ type: 'msg', from: x.id, to: to.id, text: pick(LINES) })
      } else if (roll < 0.6) {
        setState(x, 'blocked', { why: pick(['permission: git push', 'permission: rm -rf dist', 'asks: which tone?']) })
      } else if (roll < 0.64 && x.holds.size === 0) {
        emit({ type: 'close', who: x.id, task: x.task })
        setState(x, 'idle')
      }
    }
  }

  const ms = (tickMs || 1100) / speed
  setInterval(step, ms)
  return {
    sessions: s,
    byId,
    log,
    tickMs: ms,
    on: (f) => (subs.add(f), () => subs.delete(f)),
    holderOf,
  }
}

export const label = (e, byId) => {
  const n = (id) => byId[id]?.name ?? id
  switch (e.type) {
    case 'edit': return `${n(e.who)} edits ${e.file} +${e.add} −${e.rem}`
    case 'take': return `${n(e.who)} takes ${e.file}`
    case 'commit': return `${n(e.who)} commits ${e.sha} · ${e.msg} (${e.files.length} files)`
    case 'msg': return `${n(e.from)} → ${n(e.to)}: “${e.text}”`
    case 'clash': return `${n(e.who)} hits ${e.file}, held by ${n(e.other)}`
    case 'state':
      return e.state === 'blocked' ? `${n(e.who)} needs you · ${e.why}`
        : e.state === 'wait' ? `${n(e.who)} waits on ${n(e.on)}`
        : e.state === 'idle' ? `${n(e.who)} is idle` : `${n(e.who)} is back at work`
    case 'claim': return `${n(e.who)} claims “${e.task}”`
    case 'close': return `${n(e.who)} closes “${e.task}”`
  }
  return ''
}
