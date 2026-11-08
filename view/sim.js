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

// board tasks: held ones map to SESSIONS[].task; the rest wait on the board
export const TASKS = [
  { id: 'WA-1154', title: 'Vireo chat agent', repo: 'wren', status: 'In Progress' },
  { id: 'WA-1144', title: 'Shell side chat', repo: 'wren', status: 'In Progress' },
  { id: 'WA-1181', title: 'Ledger size cap', repo: 'peers', status: 'In Progress' },
  { id: 'WA-1140', title: 'Hero batch 5', repo: 'vireo', status: 'In Progress' },
  { id: 'WA-1157', title: 'Follow by person', repo: 'engine', status: 'In Progress' },
  { id: 'WA-1133', title: 'Dogfood run triage', repo: 'engine', status: 'In Progress' },
  { id: 'WA-1048', title: 'Meta push flows', repo: 'wren', status: 'Blocked', on: 'Meta review' },
  { id: 'WA-1123', title: 'Birdwatch in side chat', repo: 'engine', status: 'Blocked', on: 'William picks' },
  { id: 'WA-1178', title: 'Claims sweep', repo: 'peers', status: 'To Do' },
  { id: 'WA-1180', title: 'Trace task to commits', repo: 'peers', status: 'To Do' },
  { id: 'WA-1143', title: 'Drop column', repo: 'vireo', status: 'To Do' },
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
  const rs = rng(seed + 101)
  const rngSize = () => rs()
  const pick = (a) => a[Math.floor(r() * a.length)]
  const subs = new Set()
  const log = []
  const s = SESSIONS.map((x) => ({ ...x, state: 'work', since: 0, holds: new Map(), focus: null, commits: 0, taskId: TASKS.find((k) => k.title === x.task)?.id }))
  // live board: holders, files touched, commits per task
  const tasks = TASKS.map((k) => ({ ...k, holders: s.filter((x) => x.taskId === k.id).map((x) => x.id), files: new Set(), commits: [] }))
  const taskById = Object.fromEntries(tasks.map((k) => [k.id, k]))
  // file sizes in lines, keyed repo/path; edits per file, newest last
  const lines = new Map(), edits = new Map()
  for (const r of REPOS) for (const f of files(r.id)) lines.set(`${r.id}/${f}`, 30 + Math.floor(rngSize() * 620))
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
      if (!holderOf(x.repo, f)) { x.holds.set(f, 5 + Math.floor(r() * 30)); if (x.taskId) taskById[x.taskId].files.add(`${x.repo}/${f}`) }
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
          if (x.taskId) { const k = taskById[x.taskId]; k.status = 'In Progress'; if (!k.holders.includes(x.id)) k.holders.push(x.id) }
          emit({ type: 'claim', who: x.id, task: x.task, id: x.taskId })
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
        const key = `${x.repo}/${f}`
        lines.set(key, Math.max(5, lines.get(key) + add - rem))
        const at = Math.floor(r() * lines.get(key))
        const ed = { who: x.id, add, rem, at, t }
        edits.set(key, [...(edits.get(key) || []), ed].slice(-12))
        if (x.taskId) taskById[x.taskId].files.add(key)
        emit({ type: 'edit', who: x.id, file: f, repo: x.repo, add, rem, at, lines: lines.get(key), task: x.taskId })
      } else if (roll < 0.5 && x.holds.size >= 2) {
        const fs = [...x.holds.keys()]
        x.holds.clear()
        x.focus = null
        x.commits++
        sha += 0x1f3 + Math.floor(r() * 0xfff)
        const c = { type: 'commit', who: x.id, files: fs, repo: x.repo, sha: sha.toString(16).slice(-7), msg: pick(COMMITS), task: x.taskId }
        if (x.taskId) taskById[x.taskId].commits.push(c.sha)
        emit(c)
      } else if (roll < 0.58) {
        const to = pick(s.filter((y) => y !== x))
        emit({ type: 'msg', from: x.id, to: to.id, text: pick(LINES) })
      } else if (roll < 0.6) {
        setState(x, 'blocked', { why: pick(['permission: git push', 'permission: rm -rf dist', 'asks: which tone?']) })
      } else if (roll < 0.64 && x.holds.size === 0) {
        if (x.taskId) { const k = taskById[x.taskId]; k.holders = k.holders.filter((h) => h !== x.id); if (!k.holders.length) k.status = 'Done' }
        emit({ type: 'close', who: x.id, task: x.task, id: x.taskId })
        setState(x, 'idle')
      }
    }
  }

  const ms = (tickMs || 1100) / speed
  setInterval(step, ms)
  return {
    sessions: s,
    byId,
    tasks,
    taskById,
    lines,
    edits,
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

// fake source line for a diff view: same file + line number gives the same text
const WORDS = ['ledger', 'batch', 'rows', 'session', 'file', 'hold', 'commit', 'map', 'filter', 'next', 'state', 'emit', 'cap', 'size', 'id', 'peer', 'take', 'drop']
export function codeLine(file, n) {
  // int hash: a float reduce overflows on long paths and drops n
  const h = [...file].reduce((a, c) => (Math.imul(a, 31) + c.charCodeAt(0)) | 0, 0)
  const g = rng((h ^ Math.imul(n + 1, 2654435761)) >>> 0)
  const ind = '  '.repeat(Math.floor(g() * 3))
  const k = 2 + Math.floor(g() * 4)
  const w = Array.from({ length: k }, () => WORDS[Math.floor(g() * WORDS.length)])
  const shape = Math.floor(g() * 4)
  return ind + (shape === 0 ? `const ${w[0]} = ${w.slice(1).join('.')}()` : shape === 1 ? `if (${w[0]}.${w[1]}) ${w.slice(2).join(' ') || 'return'}` : shape === 2 ? `${w[0]}(${w.slice(1).join(', ')})` : `return ${w.join(' ')}`)
}
